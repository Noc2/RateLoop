ALTER TABLE "tokenless_account_profiles"
  ADD COLUMN "preferred_locale" text,
  ADD COLUMN "preferred_theme" text,
  ADD CONSTRAINT "tokenless_account_profiles_preferred_locale_check"
    CHECK ("preferred_locale" IS NULL OR "preferred_locale" IN ('en', 'de')),
  ADD CONSTRAINT "tokenless_account_profiles_preferred_theme_check"
    CHECK ("preferred_theme" IS NULL OR "preferred_theme" IN ('light', 'dark'));
