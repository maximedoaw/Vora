import { Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { geocode, type GeocodeFeature } from '@/lib/geocoding';
import { formatDistance, haversineKm } from '@/lib/geo-utils';

type PlaceSearchProps = {
  onSelect: (place: GeocodeFeature) => void;
  proximity?: [number, number];
  origin?: [number, number];
  selected?: GeocodeFeature | null;
  onClear?: () => void;
  placeholder?: string;
  /** Bouton collé au bout droit du champ (avatar profil). */
  trailing?: ReactNode;
};

const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;

type Status = 'idle' | 'searching' | 'done' | 'error';

export function PlaceSearch({
  onSelect,
  proximity,
  origin,
  selected,
  onClear,
  placeholder = 'Où vas-tu ?',
  trailing,
}: PlaceSearchProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeFeature[]>([]);
  const [resultsFor, setResultsFor] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const skipNextSearch = useRef(false);
  const proximityRef = useRef(proximity);
  proximityRef.current = proximity;

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    const q = query.trim();
    if (q.length < MIN_CHARS) {
      abortRef.current?.abort();
      setResults([]);
      setResultsFor('');
      setStatus('idle');
      return;
    }

    setStatus('searching');
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      void geocode(q, { proximity: proximityRef.current, signal: ac.signal })
        .then((r) => {
          if (ac.signal.aborted) return;
          setResults(r);
          setResultsFor(q);
          setStatus('done');
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError' || ac.signal.aborted) return;
          setStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [query]);

  useEffect(() => {
    if (selected === null) {
      skipNextSearch.current = true;
      setQuery('');
      setResults([]);
      setResultsFor('');
      setStatus('idle');
    }
  }, [selected]);

  const choose = (place: GeocodeFeature) => {
    skipNextSearch.current = true;
    abortRef.current?.abort();
    setQuery(place.text);
    setResults([]);
    setResultsFor('');
    setStatus('idle');
    onSelect(place);
  };

  const clear = () => {
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setResultsFor('');
    setStatus('idle');
    onClear?.();
  };

  const distances = useMemo(
    () => (origin ? results.map((r) => haversineKm(origin, r.center)) : null),
    [origin, results],
  );

  const busy = status === 'searching';
  const noResults = status === 'done' && results.length === 0 && resultsFor === query.trim();
  const showList = query.trim().length >= MIN_CHARS && (busy || status === 'done' || status === 'error');

  return (
    <View style={styles.root}>
      <View style={styles.field}>
        <Search size={18} color={colors.textMuted} style={styles.lens} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {busy ? (
          <ActivityIndicator color={colors.accent} style={styles.trailing} />
        ) : query ? (
          <Pressable onPress={clear} hitSlop={10} style={styles.trailing}>
            <X size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}

        {trailing ? (
          <View style={styles.trailingSlot}>
            <View style={styles.divider} />
            {trailing}
          </View>
        ) : null}
      </View>

      {showList ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.dropdown}
          contentContainerStyle={styles.dropdownContent}>
          {status === 'error' && results.length === 0 ? (
            <Text style={styles.meta}>Recherche indisponible. Réessaie.</Text>
          ) : null}
          {busy && results.length === 0 ? (
            <Text style={styles.meta}>Recherche en cours…</Text>
          ) : null}
          {noResults ? (
            <Text style={styles.meta}>{`Aucun lieu trouvé pour « ${query.trim()} ».`}</Text>
          ) : null}
          {results.map((r, i) => (
            <Pressable
              key={r.id}
              onPress={() => choose(r)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.rowTexts}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {r.text}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {r.place_name}
                </Text>
              </View>
              {distances ? (
                <Text style={styles.dist}>{formatDistance(distances[i])}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      alignSelf: 'stretch',
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      height: 52,
      paddingHorizontal: 14,
    },
    lens: {
      marginRight: 8,
    },
    input: {
      flex: 1,
      color: c.text,
      fontSize: 16,
    },
    trailing: {
      marginLeft: 8,
    },
    trailingSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginLeft: 8,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: 24,
      backgroundColor: c.borderStrong,
    },
    dropdown: {
      marginTop: 8,
      maxHeight: 280,
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    dropdownContent: {
      paddingVertical: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    rowTexts: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    rowSub: {
      color: c.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    dist: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    meta: {
      color: c.textSecondary,
      fontSize: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pressed: {
      backgroundColor: c.accentSoft,
    },
  });
