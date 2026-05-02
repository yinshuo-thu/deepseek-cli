// DeepSeek whale — pixel ASCII art for the splash screen.
// Drawn at 28×9. Renders fine in any monospace terminal.

export const WHALE_ART = String.raw`
        .-""""""-.
      .'          '.
     /   O      O   \
    :           '    :       DeepSeek
    |                |       ~~~~~~~~
    :    .------.    :       coding agent
     \  '        '  /
      '. '------' .'
        '-..____.-'
`;

// Compact one-line whale used in the status bar / prompts.
export const WHALE_GLYPH = '🐋';

// Larger 8-bit-style banner option (used when stdout >= 80 cols).
export const WHALE_BANNER = String.raw`
   ▄████████▄    ▄▄▄▄▄▄▄▄▄▄
  █  ●     ● █▄▄█          █▄▄
  █             █████████████ █
   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
            ~ DeepSeek ~
`;
