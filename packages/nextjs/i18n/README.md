# Locale and theme contract

RateLoop serves English at unprefixed browser URLs and German below `/de`.
`/en` canonicalizes to the unprefixed English URL. API and discovery endpoints
under `/api` and `/.well-known` are machine interfaces and never receive a
locale prefix.

The supported locales, default locale, and locale cookie live in `config.ts`.
Routing, middleware, navigation, metadata, security-header tests, and account
preference validation import that shared contract. Add a locale there only
after adding a complete catalog below `messages/<locale>` and extending the
database constraint in a new migration.

User-facing client copy belongs in the domain catalogs and is rendered with
`next-intl`. Public documentation and legal pages use the same catalogs through
`LocalizedPublicContent` so their existing English contract tests can remain
provider-free. Protocol identifiers, source material supplied by customers,
and machine response schemas are not translated.

The visual default is the operating-system color preference. An absent theme
cookie means “follow the system”; `system` is deliberately not a stored value
or a selectable control. Once a visitor toggles the theme, the only accepted
overrides are `light` and `dark`. Signed-in visitors persist that explicit
choice and their locale on the private account profile.

Theme-specific colors belong in the DaisyUI light and dark definitions in
`styles/globals.css`. Components use semantic base, content, status, and
RateLoop surface tokens. The fixed desktop rail is intentionally always black
and has its own scoped token contract.

Before adding or changing localized UI:

1. Add matching English and German messages, including identical ICU
   placeholders.
2. Use locale-aware `Link`, router, date, and number helpers for browser UI.
3. Keep internal German navigation within `/de`; never prefix machine URLs.
4. Check both themes, desktop and mobile layouts, keyboard labels, errors, and
   empty/loading states.
5. Run the catalog parity, middleware, contrast, interaction, and production
   build checks.
