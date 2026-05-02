// DeepSeek whale icon — pixel-style ASCII for the splash brand pane.
// 15 rows × 52 cols. User-supplied; sized to sit cleanly inside the left
// brand pane of the two-column splash layout.

export const WHALE_ART = String.raw`
                     .--:      =
         :+***********=      =**-        -
      .+**************+-     -****-.=++**=
     =*******************+    =*********+.
    =**********************=   .+*****+:
   :*+.  .:++***********+****+. +***
   +*=         -+******-.  +*******=
   +*+           :*****==-  -******
   :**=            -*****+:  +****-
    +**=            .************=
     +**=             =*********=
      +**+-     =+=    :******+
       .+***=.  -****:   -+****+:
          =************++=-..-==-.
             .==+++++==:
`;

// Compact single-line-art fallback for narrow terminals (< 100 cols).
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
