import { Star } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

const STARS = [1, 2, 3, 4, 5];

type Props = {
  /** Note affichée, de 0 à 5 par pas de 0,5. */
  value: number;
  /** Absent = affichage seul. */
  onChange?: (value: number) => void;
  size?: number;
  disabled?: boolean;
};

/**
 * Notation en étoiles dorées, par demi-étoiles.
 *
 * Le demi-remplissage se fait en superposant une étoile pleine découpée à la
 * moitié de sa largeur au-dessus de l'étoile vide : React Native n'offre pas de
 * dégradé partiel sur une icône, mais un conteneur `overflow: hidden` suffit.
 *
 * En mode interactif, chaque étoile porte deux zones tactiles — moitié gauche
 * pour la demi-note, moitié droite pour la note pleine.
 */
export function StarRating({ value, onChange, size = 28, disabled = false }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(), []);
  const interactive = !!onChange && !disabled;

  return (
    <View style={styles.row} accessibilityRole={interactive ? 'adjustable' : 'image'}>
      {STARS.map((index) => {
        const fill = Math.max(0, Math.min(1, value - (index - 1)));

        return (
          <View key={index} style={[styles.star, { width: size, height: size }]}>
            <Star size={size} color={colors.starEmpty} fill={colors.starEmpty} />

            {fill > 0 ? (
              <View
                pointerEvents="none"
                style={[styles.overlay, { width: size * fill, height: size }]}>
                <Star size={size} color={colors.star} fill={colors.star} />
              </View>
            ) : null}

            {interactive ? (
              <View style={styles.hits}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Noter ${index - 0.5} sur 5`}
                  onPress={() => onChange?.(index - 0.5)}
                  style={styles.hit}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Noter ${index} sur 5`}
                  onPress={() => onChange?.(index)}
                  style={styles.hit}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 6,
    },
    star: {
      position: 'relative',
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      overflow: 'hidden',
    },
    hits: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
    },
    hit: {
      flex: 1,
    },
  });
