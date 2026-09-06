import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}
