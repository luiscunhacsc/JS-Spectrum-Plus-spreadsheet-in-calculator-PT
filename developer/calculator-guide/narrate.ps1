$ErrorActionPreference = 'Stop'
$guideScenes = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scenes.json') -Raw | ConvertFrom-Json
$guideAudioDir = Join-Path $PSScriptRoot '.render/audio'
[System.IO.Directory]::CreateDirectory($guideAudioDir) | Out-Null
$guideVoice = New-Object -ComObject SAPI.SpVoice
$guideVoices = $guideVoice.GetVoices()
for ($guideVoiceIndex = 0; $guideVoiceIndex -lt $guideVoices.Count; $guideVoiceIndex++) {
    if ($guideVoices.Item($guideVoiceIndex).GetDescription() -match 'Zira') {
        $guideVoice.Voice = $guideVoices.Item($guideVoiceIndex)
        break
    }
}
$guideVoice.Rate = 0
$guideVoice.Volume = 100
for ($guideSceneIndex = 0; $guideSceneIndex -lt $guideScenes.Count; $guideSceneIndex++) {
    $guideSentenceIndex = 0
    foreach ($guideSentence in $guideScenes[$guideSceneIndex].speech) {
        $guideFile = Join-Path $guideAudioDir ('{0:D2}-{1:D2}.wav' -f ($guideSceneIndex + 1), ($guideSentenceIndex + 1))
        $guideStream = New-Object -ComObject SAPI.SpFileStream
        try {
            $guideStream.Open($guideFile, 3, $false)
            $guideVoice.AudioOutputStream = $guideStream
            [void]$guideVoice.Speak([string]$guideSentence)
        } finally {
            $guideStream.Close()
        }
        $guideSentenceIndex++
    }
    Write-Output ('Narration {0}/{1}: {2}' -f ($guideSceneIndex + 1), $guideScenes.Count, $guideScenes[$guideSceneIndex].title)
}
