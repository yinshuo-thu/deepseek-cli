// DeepSeek whale — ASCII art for the splash screen.
//
// Inspired by the official DeepSeek brand mark:
//   - chubby round body curving to the lower-left
//   - tail rising from the back, sweeping up and to the right
//   - forked fluke (v V) at the tail's tip
//   - single eye dot on the upper face
//   - small mouth / fin curve near the front
//
// Two banners ship: a wider one for terminals ≥ 60 cols and a compact
// one for narrower windows. Splash.tsx picks based on stdout width.

export const WHALE_ART = String.raw`
                                ,--.._
                              ,'  V V '\
                             |          )
                              \      ,-'
                               '.__,'
                                  \
                                   \
                  __________________\
              _.-'                   \
           ,-'        ●                \
         ,'                             |
        /                               |
       |                                /
        \                            _-'
         '.                       _,'
           '-._               _,-'
               '''---....---'''
`;

export const WHALE_ART_COMPACT = String.raw`
                  ,--._
                ,'  V V'.
                |       )
                 '.___,'
                    \
              ______ \
            ,'  ●     '.
           /            )
           \         _,'
            '.____,-'
`;

export const WHALE_GLYPH = '🐋';
