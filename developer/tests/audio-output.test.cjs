const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmulator } = require('./emulator-harness.cjs');

async function start() {
    const e = createEmulator(undefined, { audio: true });
    await e.evaluate('loadBuiltIn128K()');
    return e;
}

function near(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

for (const mode of ['128K menu', '48 BASIC']) {
    test(`${mode}: idle scheduled buffers stay exactly silent through delayed frames`, async () => {
        const e = await start();
        e.frames(200);
        if (mode === '48 BASIC') {
            for (let i = 0; i < 3; i++) e.key('ArrowDown');
            e.key('Enter');
            e.frames(100);
            assert.equal(e.evaluate('pagingLocked'), true);
        }
        for (const delay of [0.02, 0.035, 0.12, 0.02, 0.25, 0.02]) {
            const result = e.evaluate(`(() => {
                audioCtx.currentTime += ${delay};
                const before = audioCtx.starts.length;
                loop();
                return { scheduled: audioCtx.starts.length > before,
                    silent: audioCtx.lastBuffer.getChannelData(0).every(sample => sample === 0) };
            })()`);
            if (delay >= 0.12) assert.equal(result.scheduled, true);
            assert.equal(result.silent, true, `idle PCM after a ${delay}s delay`);
        }
    });
}

for (const level of ['beeper', 'AY fixed', 'AY held envelope', 'combined']) {
    test(`${level}: a constant level decays across frames and clamps to exact silence`, () => {
        const e = createEmulator();
        const beeper = level === 'beeper' || level === 'combined';
        const ay = level !== 'beeper';
        const held = level === 'AY held envelope';
        e.evaluate(`lastSpeakerState = ${beeper ? 1 : 0};
            ayChip.write(7, 63);
            for (let register = 8; register <= 10; register++) ayChip.write(register, ${ay ? (held ? 16 : 15) : 0});
            ${held ? 'ayChip.write(13, 13); ayChip.sample(FRAME_TSTATES);' : ''}`);
        const first = e.evaluate('synthesizeAudioFrame([], [])');
        const second = e.evaluate('synthesizeAudioFrame([], [])');
        const initial = (beeper ? 1 : 0) + (ay ? 0.5 : 0);
        const r = Math.exp(-2 * Math.PI * 20 / 44100);
        near(first[0], initial);
        near(first.at(-1), initial * r ** (first.length - 1));
        near(second[0], first.at(-1) * r);
        assert.ok(second[0] > 0, 'history must continue, not restart or subtract a frame mean');
        e.evaluate('for (let frame = 0; frame < 12; frame++) synthesizeAudioFrame([], []);');
        assert.equal(e.evaluate('synthesizeAudioFrame([], []).every(sample => sample === 0)'), true);
    });
}

test('beeper edges retain unit amplitude and sample timing across a frame boundary', () => {
    const e = createEmulator();
    const first = e.evaluate('synthesizeAudioFrame([{ t: FRAME_TSTATES, val: 1 }], [])');
    assert.ok(first.slice(0, -1).every(sample => sample === 0));
    near(first.at(-1), 1);
    const second = e.evaluate('synthesizeAudioFrame([], [])');
    const r = Math.exp(-2 * Math.PI * 20 / 44100);
    near(second[0], r);
    const third = e.evaluate('synthesizeAudioFrame([{ t: 0, val: 0 }], [])');
    near(third[0] - second.at(-1) * r, -1);
    assert.ok(Math.min(...third) < -0.9, 'the falling edge must remain audible');
});

test('repeated beeps retain both polarities and audible energy', () => {
    const e = createEmulator();
    const data = e.evaluate(`(() => {
        const edges = Array.from({ length: 40 }, (_, i) => ({ t: i * FRAME_TSTATES / 40, val: (i + 1) % 2 }));
        for (let frame = 0; frame < 10; frame++) synthesizeAudioFrame(edges, []);
        return synthesizeAudioFrame(edges, []);
    })()`);
    assert.ok(Math.max(...data) > 0.45);
    assert.ok(Math.min(...data) < -0.45);
    const rms = Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
    assert.ok(rms > 0.45 && rms < 0.55, `1 kHz beeper RMS: ${rms}`);
});

test('timed AY volume writes keep their edges while the DC tail decays', () => {
    const e = createEmulator();
    const data = e.evaluate(`(() => {
        ayChip.write(7, 63);
        frameTStates = FRAME_TSTATES / 4;
        writePort(0xFFFD, 8); writePort(0xBFFD, 15);
        frameTStates = 3 * FRAME_TSTATES / 4;
        writePort(0xBFFD, 0);
        return synthesizeAudioFrame([]);
    })()`);
    const r = Math.exp(-2 * Math.PI * 20 / 44100);
    assert.ok(data.slice(0, 220).every(sample => sample === 0));
    near(data[220], 1 / 6);
    near(data[660], data[659] * r);
    near(data[661] - data[660] * r, -1 / 6);
    for (let i = 662; i < data.length; i++) near(data[i], data[i - 1] * r);
});

for (const signal of ['tone', 'noise', 'envelope']) {
    test(`AY ${signal} retains audible variation after DC removal`, () => {
        const e = createEmulator();
        const data = e.evaluate(`(() => {
            ayChip.write(0, 100); ayChip.write(6, 3);
            ayChip.write(7, ${signal === 'tone' ? 62 : signal === 'noise' ? 55 : 63});
            ayChip.write(8, ${signal === 'envelope' ? 16 : 15});
            ayChip.write(11, 20); ayChip.write(13, 14);
            for (let frame = 0; frame < 10; frame++) synthesizeAudioFrame([], []);
            return synthesizeAudioFrame([], []);
        })()`);
        assert.ok(Math.max(...data) > 0.02);
        assert.ok(Math.min(...data) < -0.02);
        assert.ok(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length > 0.001);
    });
}

test('startup and underruns get 40 ms lead; normal buffers remain contiguous', async () => {
    const e = await start();
    near(e.evaluate('audioCtx.starts[0]'), 0.04, 1e-12);
    const result = e.evaluate(`(() => {
        audioCtx.currentTime += 0.02;
        const expected = nextAudioTime;
        processAudioFrame([]);
        const normal = audioCtx.starts.at(-1);
        audioCtx.currentTime = nextAudioTime + 0.1;
        processAudioFrame([]);
        const recovery = audioCtx.starts.at(-1) - audioCtx.currentTime;
        const recoveryEnd = nextAudioTime;
        processAudioFrame([]);
        const contiguous = audioCtx.starts.at(-1) === recoveryEnd;
        audioCtx.currentTime = nextAudioTime;
        processAudioFrame([]);
        return { expected, normal, recovery, contiguous,
            exactDeadline: audioCtx.starts.at(-1) - audioCtx.currentTime };
    })()`);
    near(result.normal, result.expected, 1e-12);
    near(result.recovery, 0.04, 1e-12);
    assert.equal(result.contiguous, true);
    near(result.exactDeadline, 0.04, 1e-12);
});

test('audio pacing runs about 50 CPU frames per second under 60 Hz animation callbacks', async () => {
    const e = await start();
    const result = e.evaluate(`(() => {
        const before = audioCtx.starts.length;
        for (let callback = 0; callback < 600; callback++) {
            audioCtx.currentTime += 1 / 60;
            loop();
        }
        return { frames: audioCtx.starts.length - before,
            lead: nextAudioTime - audioCtx.currentTime,
            contiguous: audioCtx.starts.every((time, i, starts) => !i || Math.abs(time - starts[i - 1] - 0.02) < 1e-10) };
    })()`);
    assert.ok(result.frames >= 499 && result.frames <= 503, `CPU frames in 10 seconds: ${result.frames}`);
    assert.ok(result.lead >= 0.04 && result.lead <= 0.101);
    assert.equal(result.contiguous, true);
});

test('suspended audio keeps CPU/chip execution moving and resumes with scheduling lead', async () => {
    const e = await start();
    const result = e.evaluate(`(() => {
        audioCtx.state = 'suspended'; nextAudioTime = 100;
        const before = audioCtx.starts.length;
        let cpuFrames = 0;
        const original = processAudioFrame;
        processAudioFrame = log => { cpuFrames++; original(log); };
        // AudioContext time is frozen during suspension.
        for (let frame = 0; frame < 5; frame++) loop();
        const during = audioCtx.starts.length;
        frameTStates = 0; ayLog = [];
        writePort(0xFFFD, 8); writePort(0xBFFD, 15);
        processAudioFrame([]);
        const chipVolume = ayChip.registers[8];
        audioCtx.state = 'running';
        loop();
        return { cpuFrames, before, during, chipVolume,
            lead: audioCtx.starts.at(-1) - audioCtx.currentTime };
    })()`);
    assert.equal(result.cpuFrames, 7);
    assert.equal(result.before, result.during);
    assert.equal(result.chipVolume, 15);
    near(result.lead, 0.04, 1e-12);
});

for (const operation of ['resetSystem()', 'loadBuiltIn128K()']) {
    test(`${operation} clears audio filter history and restores startup lead`, async () => {
        const e = await start();
        e.evaluate('synthesizeAudioFrame([{ t: FRAME_TSTATES, val: 1 }], []);');
        await e.evaluate(operation);
        assert.equal(e.evaluate('audioCtx.lastBuffer.getChannelData(0).every(sample => sample === 0)'), true);
        near(e.evaluate('audioCtx.starts.at(-1) - audioCtx.currentTime'), 0.04, 1e-12);
    });
}
