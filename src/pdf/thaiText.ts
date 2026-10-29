/**
 * StructBOQ - Thai text repair for PDFs exported with legacy Thai fonts
 * (glyphs mapped onto Latin-1 / Latin Extended-A, e.g. "Ēïï ðø.4" = "แบบ ปร.4").
 */
const VARIANTS: Record<number, string> = {
  0x150: '่', 0x151: '้', 0x152: '๊', 0x153: '๋', 0x154: '์',
  0x155: '่', 0x156: '้', 0x157: 'ิ', 0x158: 'ี', 0x159: 'ึ',
  0x15A: 'ื', 0x15B: '่', 0x15C: '้', 0x15D: '๊', 0x15E: '๋',
  0x15F: '์', 0x160: '่', 0x161: '้', 0x162: '๊', 0x163: '๋',
  0x164: '์', 0x165: 'ํ', 0x166: 'ั', 0x167: '็', 0x168: '็',
  0x169: 'ํ', 0x16A: '้', 0x16B: '๊', 0x16C: '๋', 0x16D: '์',
  0x16E: 'ญ', 0x16F: 'ฐ',
};

const LEGACY = /[Õ-ĞŐ-ů]/g;
const THAI = /[ก-๛]/g;

export function looksLegacyThai(text: string): boolean {
  const legacy = (text.match(LEGACY) || []).length;
  const thai = (text.match(THAI) || []).length;
  return legacy >= 20 && legacy > thai * 2;
}

export function decodeLegacyThai(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xD5 && c <= 0x110) out += String.fromCodePoint(c + 0xD2B);
    else if (c >= 0x111 && c <= 0x11E) out += String.fromCodePoint(c + 0xD2F);
    else out += VARIANTS[c] ?? ch;
  }
  return out;
}

/** Shifted marks some Thai fonts put in the Private Use Area (U+F700–F71A) -> standard Thai */
const PUA = 'ฐิีึื่้๊๋์่้๊๋์ญัํ็่้๊๋์ฺุู';

export function normalizeThai(text: string, force = false): string {
  const t = force || looksLegacyThai(text) ? decodeLegacyThai(text) : text;
  return t.replace(/[-]/g, c => PUA[c.charCodeAt(0) - 0xF700]).replace(/ํา/g, 'ำ');
}
