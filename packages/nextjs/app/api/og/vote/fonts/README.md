# OG card fonts

These static TTF files are used by `app/api/og/vote/route.tsx` because
`ImageResponse`/Satori accepts OpenType or TrueType font bytes, while the site
font output from `next/font/google` is WOFF2.

They are static instances generated from the official Google Fonts variable
sources used by the website:

- Inter: https://github.com/google/fonts/tree/main/ofl/inter
- Space Grotesk: https://github.com/google/fonts/tree/main/ofl/spacegrotesk

The source fonts are distributed under the SIL Open Font License.
