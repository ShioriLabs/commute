import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

interface InstallContextType {
  isInstallable: boolean
  showIOSInstructions: boolean
  isStandalone: boolean
  promptInstall: () => Promise<boolean>
}

const InstallContext = createContext<InstallContextType>({
  isInstallable: false,
  showIOSInstructions: false,
  isStandalone: false,
  promptInstall: async () => false
})

export function InstallableProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Check if already running as installed app
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      || (window.navigator as any).standalone
      || document.referrer.includes('android-app://')

    setIsStandalone(standalone)

    // If already installed, don't show anything
    if (standalone) {
      return
    }

    // Detect iOS Safari
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

    if (isIOS && isSafari) {
      setShowIOSInstructions(true)
      return
    }

    // For Chrome/Edge on Android - wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    window.addEventListener('beforeinstallprompt', handler)

    const installedHandler = () => {
      setIsInstallable(false)
      setShowIOSInstructions(false)
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setIsInstallable(false)
    }

    setDeferredPrompt(null)
    return outcome === 'accepted'
  }, [deferredPrompt])

  return (
    <InstallContext.Provider value={{ isInstallable, showIOSInstructions, isStandalone, promptInstall }}>
      {children}
    </InstallContext.Provider>
  )
}

export function useInstall() {
  const context = useContext(InstallContext)

  if (context === undefined) {
    throw new Error('useInstall must be used within an InstallProvider')
  }

  return context
}
