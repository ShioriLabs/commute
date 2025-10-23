import { useEffect, useState } from 'react'

export type NetworkStatus = 'ONLINE' | 'OFFLINE'

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>(navigator.onLine ? 'ONLINE' : 'OFFLINE')

  useEffect(() => {
    function handleOnline() {
      setStatus('ONLINE')
    }

    function handleOffline() {
      setStatus('OFFLINE')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return status
}
