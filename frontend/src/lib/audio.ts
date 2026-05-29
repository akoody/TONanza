class AudioEngine {
    init() { }
    setEnabled(_val: boolean) { }
    playUiClick() { }
    playActionConfirm() { }
    playActionSuccess() { }
    playActionError() { }
    playBetPlaced() { }
    playBetCancelled() { }
    playTick() { }
    playWinSound() { }
}

export const soundEngine = new AudioEngine();
