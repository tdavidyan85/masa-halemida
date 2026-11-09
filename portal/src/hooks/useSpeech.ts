import { useCallback, useEffect, useState } from 'react'

// Read a text aloud with the device's own voice (Web Speech API). Nothing is sent to any server.
export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel() }, [supported])
  const speak = useCallback((text: string) => {
    if (!supported) return
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'he-IL'
    u.rate = 0.85
    const he = synth.getVoices().find(v => v.lang.startsWith('he'))
    if (he) u.voice = he
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(u)
  }, [supported])
  const stop = useCallback(() => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false) }, [supported])
  return { supported, speaking, speak, stop }
}
