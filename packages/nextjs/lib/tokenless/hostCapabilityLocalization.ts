import type { Locale } from "~~/i18n/config";

/**
 * Shared translations for copy owned by the host-capability registry. Both the
 * authenticated picker and public host guides render through this function so
 * the same capability cannot acquire different wording across surfaces.
 */
const GERMAN_HOST_CAPABILITY_COPY: Readonly<Record<string, string>> = {
  "Approve the RateLoop Workspace plugin install": "Genehmigen Sie die Installation des RateLoop-Workspace-Plugins",
  "Approve the host trust prompt if one appears": "Bestätigen Sie gegebenenfalls die Vertrauensabfrage des Hosts",
  "Approve the RateLoop OAuth consent screen": "Genehmigen Sie die RateLoop-OAuth-Einwilligung",
  "RateLoop Workspace plugin from the tokenless-pinned Noc2/RateLoop marketplace":
    "RateLoop-Workspace-Plugin aus dem auf Tokenless fixierten Noc2/RateLoop-Marketplace",
  "Install the protected workspace plugin from the tokenless-pinned marketplace":
    "Geschütztes Workspace-Plugin aus dem auf Tokenless fixierten Marketplace installieren",
  "Approve the RateLoop OAuth authorization in the browser":
    "Genehmigen Sie die RateLoop-OAuth-Autorisierung im Browser",
  "Generic remote-server registration without RateLoop's hooks; authorize from /mcp":
    "Generische Registrierung des Remote-Servers ohne RateLoop-Hooks; Autorisierung über /mcp",
  "Add the RateLoop connector in the host's settings":
    "Fügen Sie den RateLoop-Connector in den Hosteinstellungen hinzu",
  "Connector setup in the host's settings": "Connector-Einrichtung in den Hosteinstellungen",
  "Add the RateLoop connector in this host's settings and approve the OAuth consent; a pasted message alone cannot install it. Details: /docs/connect":
    "Fügen Sie den RateLoop-Connector in den Einstellungen dieses Hosts hinzu und genehmigen Sie OAuth; eine eingefügte Nachricht allein kann ihn nicht installieren. Einzelheiten: /docs/connect",
  "Add the server entry to the local mcp.json and start it":
    "Fügen Sie den Servereintrag zur lokalen mcp.json hinzu und starten Sie ihn",
  "Use the host's Auth action when it appears": "Nutzen Sie die Auth-Aktion des Hosts, sobald sie erscheint",
  "Local mcp.json servers entry; leave the optional oauth.clientId unset — none is preregistered":
    "Lokaler Servereintrag in mcp.json; lassen Sie die optionale oauth.clientId leer – keine ist vorregistriert",
  "Add the server entry to the host's MCP settings":
    "Fügen Sie den Servereintrag zu den MCP-Einstellungen des Hosts hinzu",
  "Register the server with gemini mcp add": "Registrieren Sie den Server mit gemini mcp add",
  "Run /mcp auth rateloop-workspace if authentication is required":
    "Führen Sie bei erforderlicher Authentifizierung /mcp auth rateloop-workspace aus",
  "Register at user scope, then run /mcp auth rateloop-workspace if prompted":
    "Registrieren Sie im Nutzerumfang und führen Sie bei Aufforderung /mcp auth rateloop-workspace aus",
  "settings.json entry; the transport field is httpUrl, not url plus type":
    "settings.json-Eintrag; das Transportfeld ist httpUrl, nicht url plus type",
  "Connector setup in the host's connector settings": "Connector-Einrichtung in den Connector-Einstellungen des Hosts",
  "Add the RateLoop connector in this host's connector settings and approve the OAuth consent. Details: /docs/connect":
    "Fügen Sie den RateLoop-Connector in den Connector-Einstellungen dieses Hosts hinzu und genehmigen Sie OAuth. Einzelheiten: /docs/connect",
  "Register the RateLoop workspace MCP server in the client":
    "Registrieren Sie den RateLoop-Workspace-MCP-Server im Client",
  "Open the device authorization link the environment reports":
    "Öffnen Sie den von der Umgebung gemeldeten Geräteautorisierungslink",
  "RateLoop agents CLI with a workspace API key": "RateLoop-Agenten-CLI mit Workspace-API-Schlüssel",
};

export function localizeTokenlessHostCapabilityCopy(source: string, locale: Locale) {
  return locale === "de" ? (GERMAN_HOST_CAPABILITY_COPY[source] ?? source) : source;
}

export function hasTokenlessHostCapabilityTranslation(source: string, locale: Exclude<Locale, "en">) {
  return locale === "de" && Object.hasOwn(GERMAN_HOST_CAPABILITY_COPY, source);
}
