/**
 * Whitepaper PDF generator.
 * Run: yarn whitepaper  (or:  npx tsx scripts/whitepaper/generate.tsx)
 * Outputs: public/rateloop-whitepaper.pdf
 */
import React from "react";
import { ContentBlock, EXECUTIVE_SUMMARY, META, SECTIONS, TableData } from "./content";
import { renderLatex } from "./latex";
import { Document, Page, Path, StyleSheet, Svg, Text, View, renderToFile, renderToStream } from "@react-pdf/renderer";

// ── Brand colors ──
const BLUE = "#359EEE";
const GREEN = "#03CEA4";
const PINK = "#EF476F";
const YELLOW = "#FFC43D";
const EMBER = BLUE;
const STEEL = "#7E8996";
const DARK = "#090A0C";
const GRAY = STEEL;
const LIGHT_BG = "#F5F5F5";
// Per-section accent colors (cycles through the website palette)
const SECTION_COLORS = [BLUE, GREEN, YELLOW, PINK, BLUE, GREEN, YELLOW, PINK, BLUE];

// Module-level map populated during first render pass (for TOC page numbers)
const sectionPageMap: Record<number, number> = {};

// ── Styles ──
const s = StyleSheet.create({
  page: {
    paddingTop: 60,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: DARK,
    lineHeight: 1.6,
  },
  // Cover
  cover: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 60 },
  coverLogoFrame: {
    width: 170,
    height: 170,
    alignItems: "center",
    justifyContent: "center",
  },
  coverLogoSvg: { width: 170, height: 170 },
  coverProductTitle: {
    fontSize: 42,
    lineHeight: 1.05,
    fontFamily: "Helvetica-Bold",
    color: DARK,
    marginTop: 28,
    marginBottom: 18,
    textAlign: "center",
  },
  coverSubtitle: { fontSize: 17, lineHeight: 1.2, fontFamily: "Helvetica-Bold", color: DARK, textAlign: "center" },
  coverDeck: { fontSize: 12, lineHeight: 1.3, color: GRAY, marginTop: 12, textAlign: "center" },
  coverMeta: { fontSize: 10, color: GRAY, marginTop: 28, textAlign: "center" },
  // TOC
  tocTitle: { fontSize: 24, fontFamily: "Helvetica-Bold", color: DARK, marginBottom: 20 },
  tocEntry: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e0e0e0",
  },
  tocNum: { fontSize: 11, fontFamily: "Helvetica-Bold", color: EMBER, width: 20 },
  tocLabel: { fontSize: 11, color: DARK, flex: 1 },
  tocSubEntry: {
    flexDirection: "row" as const,
    paddingVertical: 2,
    paddingLeft: 20,
  },
  tocSubNum: { fontSize: 9, fontFamily: "Helvetica-Bold", width: 28 },
  tocSubLabel: { fontSize: 9, flex: 1 },
  // Section
  sectionTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", color: EMBER, marginBottom: 14 },
  sectionLead: { fontSize: 11, color: GRAY, marginBottom: 8 },
  subHeading: { fontSize: 14, fontFamily: "Helvetica-Bold", color: DARK, marginTop: 16, marginBottom: 6 },
  subSubHeading: { fontSize: 11, fontFamily: "Helvetica-Bold", color: DARK, marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 8 },
  bulletRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 8 },
  orderedRow: { flexDirection: "row", marginBottom: 6, paddingLeft: 8 },
  bulletDot: { width: 12, color: EMBER, fontFamily: "Helvetica-Bold" },
  bulletText: { flex: 1 },
  orderedNum: { width: 18, color: EMBER, fontFamily: "Helvetica-Bold" },
  // Table
  table: { marginVertical: 8, borderWidth: 0.5, borderColor: "#d0d0d0" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: EMBER },
  tableHeaderCell: { flex: 1, padding: 5, fontSize: 9, fontFamily: "Helvetica-Bold", color: "#fff" },
  tableRow: { flexDirection: "row" },
  tableRowAlt: { backgroundColor: LIGHT_BG },
  tableCell: { flex: 1, padding: 5, fontSize: 9, borderTopWidth: 0.5, borderTopColor: "#d0d0d0" },
  // Footer
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#999",
  },
});

function CoverLogo() {
  return (
    <View style={s.coverLogoFrame}>
      <Svg viewBox="0 0 128 128" style={s.coverLogoSvg}>
        <Path d="M64 21 A43 43 0 0 1 85.5 26.761" fill="none" stroke={YELLOW} strokeWidth={10} />
        <Path d="M85.5 26.761 A43 43 0 0 1 101.239 42.5" fill="none" stroke={YELLOW} strokeWidth={10} />
        <Path d="M101.239 42.5 A43 43 0 0 1 107 64" fill="none" stroke={YELLOW} strokeWidth={10} />
        <Path d="M107 64 A43 43 0 0 1 101.239 85.5" fill="none" stroke={PINK} strokeWidth={10} />
        <Path d="M101.239 85.5 A43 43 0 0 1 85.5 101.239" fill="none" stroke={PINK} strokeWidth={10} />
        <Path d="M85.5 101.239 A43 43 0 0 1 64 107" fill="none" stroke={PINK} strokeWidth={10} />
        <Path d="M64 107 A43 43 0 0 1 42.5 101.239" fill="none" stroke={PINK} strokeWidth={10} />
        <Path d="M42.5 101.239 A43 43 0 0 1 26.761 85.5" fill="none" stroke={BLUE} strokeWidth={10} />
        <Path d="M26.761 85.5 A43 43 0 0 1 21 64" fill="none" stroke={BLUE} strokeWidth={10} />
        <Path d="M21 64 A43 43 0 0 1 26.761 42.5" fill="none" stroke={BLUE} strokeWidth={10} />
        <Path d="M26.761 42.5 A43 43 0 0 1 42.5 26.761" fill="none" stroke={GREEN} strokeWidth={10} />
        <Path d="M42.5 26.761 A43 43 0 0 1 64 21" fill="none" stroke={GREEN} strokeWidth={10} />
      </Svg>
    </View>
  );
}

// ── PDF Table component ──
function PdfTable({ data, color }: { data: TableData; color: string }) {
  return (
    <View style={s.table}>
      <View style={[s.tableHeaderRow, { backgroundColor: color }]}>
        {data.headers.map((h, i) => (
          <Text key={i} style={s.tableHeaderCell}>
            {h}
          </Text>
        ))}
      </View>
      {data.rows.map((row, ri) => (
        <View key={ri} style={[s.tableRow, ri % 2 === 1 ? s.tableRowAlt : {}]}>
          {row.map((cell, ci) => (
            <Text key={ci} style={s.tableCell}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Content block renderer ──
function RenderBlock({ block, color }: { block: ContentBlock; color: string }) {
  switch (block.type) {
    case "paragraph":
      return <Text style={s.paragraph}>{block.text}</Text>;
    case "sub_heading":
      return (
        <Text style={s.subSubHeading} minPresenceAhead={30}>
          {block.text}
        </Text>
      );
    case "bullets":
      return (
        <View style={{ marginBottom: 8 }}>
          {block.items.map((item, i) => (
            <View key={i} style={s.bulletRow} wrap={false}>
              <Text style={[s.bulletDot, { color }]}>{"\u2022"}</Text>
              <Text style={s.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      );
    case "ordered":
      return (
        <View style={{ marginBottom: 8 }} wrap={false}>
          {block.items.map((item, i) => (
            <View key={i} style={s.orderedRow} wrap={false}>
              <Text style={[s.orderedNum, { color }]}>{i + 1}.</Text>
              <Text style={s.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return <PdfTable data={block.data} color={color} />;
    case "formula": {
      try {
        const { element, height } = renderLatex(block.latex, DARK);
        return <View style={{ alignItems: "center", marginVertical: 6, minHeight: height }}>{element}</View>;
      } catch (err) {
        console.warn("LaTeX render failed:", block.latex, err);
        return <Text style={s.paragraph}>[Formula: {block.latex}]</Text>;
      }
    }
  }
}

// ── Footer ──
function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text>RateLoop Whitepaper</Text>
      <Text render={({ pageNumber }) => `${pageNumber}`} />
    </View>
  );
}

// ── Main document ──
function WhitepaperDocument({ tocPageNumbers }: { tocPageNumbers?: Record<number, number> }) {
  return (
    <Document title="RateLoop Whitepaper" author={META.author} subject={`${META.subtitle} — ${META.deck}`}>
      {/* Cover page */}
      <Page size="A4" style={[s.page, { paddingTop: 0, paddingBottom: 0 }]}>
        <View style={s.cover}>
          <CoverLogo />
          <Text style={s.coverProductTitle}>RateLoop</Text>
          <Text style={s.coverSubtitle}>{META.subtitle}</Text>
          <Text style={s.coverDeck}>{META.deck}</Text>
          <Text style={s.coverMeta}>
            Author: {META.author}
            {"  |  "}Version {META.version}
            {"  |  "}
            {META.date}
          </Text>
        </View>
      </Page>

      {/* Executive Summary */}
      <Page size="A4" style={s.page}>
        <Text style={[s.sectionTitle, { color: DARK }]}>Executive Summary</Text>
        {EXECUTIVE_SUMMARY.map((block, i) => (
          <RenderBlock key={i} block={block} color={EMBER} />
        ))}
        <Footer />
      </Page>

      {/* Table of Contents */}
      <Page size="A4" style={s.page}>
        <Text style={s.tocTitle}>Table of Contents</Text>
        {SECTIONS.map((sec, i) => {
          const color = SECTION_COLORS[i % SECTION_COLORS.length];
          return (
            <View key={i}>
              <View style={s.tocEntry}>
                <Text style={[s.tocNum, { color }]}>{i + 1}</Text>
                <Text style={[s.tocLabel, { color, fontFamily: "Helvetica-Bold" }]}>{sec.title}</Text>
                {tocPageNumbers?.[i] != null && (
                  <Text style={{ fontSize: 11, color: GRAY, width: 30, textAlign: "right" }}>{tocPageNumbers[i]}</Text>
                )}
              </View>
              {sec.subsections.map((sub, j) => (
                <View key={j} style={s.tocSubEntry}>
                  <Text style={[s.tocSubNum, { color }]}>
                    {i + 1}.{j + 1}
                  </Text>
                  <Text style={[s.tocSubLabel, { color }]}>{sub.heading}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <Footer />
      </Page>

      {/* Content pages — one page-break per section */}
      {SECTIONS.map((sec, si) => {
        const accent = SECTION_COLORS[si % SECTION_COLORS.length];
        return (
          <Page key={si} size="A4" style={s.page} wrap bookmark={`${si + 1}. ${sec.title}`}>
            {/* Invisible element to capture page number for TOC */}
            <Text
              style={{ position: "absolute", fontSize: 0 }}
              render={({ pageNumber }) => {
                sectionPageMap[si] = pageNumber;
                return "";
              }}
            />
            <Text style={[s.sectionTitle, { color: accent }]}>
              {si + 1}. {sec.title}
            </Text>
            <Text style={s.sectionLead}>{sec.lead}</Text>
            {sec.subsections.map((sub, subi) => (
              <View key={subi}>
                <Text style={s.subHeading} minPresenceAhead={40}>
                  {si + 1}.{subi + 1} {sub.heading}
                </Text>
                {sub.blocks.map((block, bi) => (
                  <RenderBlock key={bi} block={block} color={accent} />
                ))}
              </View>
            ))}
            <Footer />
          </Page>
        );
      })}
    </Document>
  );
}

// ── Generate ──
async function main() {
  const outPath = new URL("../../public/rateloop-whitepaper.pdf", import.meta.url).pathname;
  console.log("Generating whitepaper PDF...");

  // Pass 1: render to stream to collect section page numbers via render callbacks
  console.log("  Pass 1: collecting page numbers...");
  const stream = await renderToStream(<WhitepaperDocument />);
  // Drain the stream to ensure all render callbacks have fired
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
    stream.resume();
  });
  const collectedPages = { ...sectionPageMap };
  console.log("  Page numbers:", collectedPages);

  // Pass 2: render to file with TOC page numbers filled in
  console.log("  Pass 2: rendering final PDF...");
  await renderToFile(<WhitepaperDocument tocPageNumbers={collectedPages} />, outPath);
  console.log(`Done! Saved to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
