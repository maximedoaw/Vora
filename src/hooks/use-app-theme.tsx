import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { VoraColors, type ColorScheme, type VoraPalette } from '@/constants/theme';

const STORAGE_KEY = 'vora.color-scheme';

/** Thème par défaut, avant tout choix de l'utilisateur. */
const DEFAULT_SCHEME: ColorScheme = 'light';

type AppTheme = {
  scheme: ColorScheme;
  colors: VoraPalette;
  setScheme: (scheme: ColorScheme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<AppTheme | null>(null);

function isScheme(value: string | null): value is ColorScheme {
  return value === 'light' || value === 'dark';
}

/**
 * Lecture/écriture du choix de thème.
 * `expo-secure-store` n'existe pas sur le web : on y retombe sur `localStorage`,
 * et toute erreur laisse simplement le thème par défaut.
 */
async function readScheme(): Promise<ColorScheme | null> {
  try {
    if (Platform.OS === 'web') {
      const value = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
      return isScheme(value) ? value : null;
    }
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    return isScheme(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeScheme(scheme: ColorScheme): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(STORAGE_KEY, scheme);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, scheme);
  } catch (error) {
    console.warn('[theme] préférence non enregistrée', error);
  }
}

/**
 * Thème de l'application. Volontairement indépendant du réglage système :
 * Vora s'ouvre en clair, et l'utilisateur bascule depuis sa page compte.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>(DEFAULT_SCHEME);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await readScheme();
      if (active && stored) setSchemeState(stored);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setScheme = useCallback((next: ColorScheme) => {
    setSchemeState(next);
    void writeScheme(next);
  }, []);

  const value = useMemo<AppTheme>(
    () => ({
      scheme,
      colors: VoraColors[scheme],
      setScheme,
      toggle: () => setScheme(scheme === 'dark' ? 'light' : 'dark'),
    }),
    [scheme, setScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppTheme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useAppTheme doit être utilisé sous <AppThemeProvider>.');
  }
  return theme;
}
