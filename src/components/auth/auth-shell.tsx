import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GRID_IMAGES = [
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&q=80',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&q=80',
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&q=80',
  'https://images.unsplash.com/photo-1511919884226-fd3cad34687a?w=400&q=80',
  'https://images.unsplash.com/photo-1483729558449-99ef03a8d07c?w=400&q=80',
  'https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?w=400&q=80',
  'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=400&q=80',
  'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&q=80',
  'https://images.unsplash.com/photo-1444723121867-7a2415777000?w=400&q=80',
];

type Props = {
  /**
   * `full` : héros plein écran (page d'accueil).
   * `compact` : héros réduit pour laisser la place à un formulaire + clavier.
   */
  variant?: 'full' | 'compact';
  /** Affiche la flèche de retour quand la vue est empilée sur l'accueil. */
  onBack?: () => void;
  children: ReactNode;
};

/**
 * Décor commun à tous les écrans d'entrée (accueil, e-mail, onboarding) :
 * mosaïque de photos, dégradé vers le noir, logo, puis la zone d'actions.
 */
export function AuthShell({ variant = 'full', onBack, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = variant === 'compact';
  const tileSize = height * 0.2;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          <View style={[styles.hero, compact ? { height: height * 0.26 } : styles.heroFull]}>
            <View style={styles.grid}>
              {GRID_IMAGES.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={[styles.tile, { height: tileSize }]}
                  contentFit="cover"
                />
              ))}
            </View>
            <View style={styles.dim} />
            <LinearGradient
              colors={['transparent', '#000000']}
              locations={[0.15, 1]}
              style={styles.fade}
            />
            <Image
              source={require('@/assets/images/vora.png')}
              style={[styles.logo, compact && styles.logoCompact]}
              contentFit="cover"
            />
          </View>

          <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Revenir en arrière"
          onPress={onBack}
          hitSlop={16}
          style={({ pressed }) => [styles.back, { top: insets.top + 8 }, pressed && styles.backPressed]}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  hero: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  heroFull: {
    flex: 1.15,
  },
  grid: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    width: '33.333%',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  logoCompact: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  actions: {
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 14,
  },
  back: {
    position: 'absolute',
    left: 18,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    opacity: 0.6,
  },
  backGlyph: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    marginTop: -4,
  },
});
