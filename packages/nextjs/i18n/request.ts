import { DEFAULT_LOCALE, isLocale } from "./config";
import { getMessagesForLocale } from "./messages";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: getMessagesForLocale(locale),
    timeZone: "UTC",
  };
});
