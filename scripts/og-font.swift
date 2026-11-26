// Draws the letters the link-preview pictures use (worker/ogimage.js) from the site's own Geist fonts
// (public/fonts, SIL Open Font License), one face and size at a time, and writes them out for
// scripts/og-font.mjs to pack into worker/og-font.js. Run on a Mac:
//   swift scripts/og-font.swift <out-dir> && node scripts/og-font.mjs <out-dir>
import CoreText
import CoreGraphics
import Foundation

struct Face { let id: String; let file: String; let weight: Double; let size: CGFloat; let chars: String }

let ascii = (32...126).map { String(UnicodeScalar($0)!) }.joined()
let latin = (0xC0...0xFF).filter { $0 != 0xD7 && $0 != 0xF7 }.map { String(UnicodeScalar($0)!) }.joined()
let punct = "·•…–—‘’“”€£¡¿°×"
let text = ascii + latin + punct
let mono = ascii + "·"

let faces = [
  Face(id: "eye", file: "geist-mono-5.3-latin.woff2", weight: 500, size: 26, chars: mono),
  Face(id: "title", file: "geist-5.3-latin.woff2", weight: 600, size: 72, chars: text),
  Face(id: "body", file: "geist-5.3-latin.woff2", weight: 400, size: 34, chars: text),
  Face(id: "big", file: "geist-mono-5.3-latin.woff2", weight: 600, size: 80, chars: mono),
  Face(id: "num", file: "geist-mono-5.3-latin.woff2", weight: 600, size: 54, chars: mono),
  Face(id: "small", file: "geist-5.3-latin.woff2", weight: 400, size: 26, chars: text),
  Face(id: "brand", file: "geist-5.3-latin.woff2", weight: 600, size: 40, chars: "remynd.spac")
]

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let fonts = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../public/fonts")
var meta: [[String: Any]] = []
var bytes = Data()

func tag(_ s: String) -> Int { s.unicodeScalars.reduce(0) { ($0 << 8) | Int($1.value) } }

for face in faces {
  let data = try! Data(contentsOf: fonts.appendingPathComponent(face.file)) as CFData
  guard let desc = CTFontManagerCreateFontDescriptorFromData(data) else { fatalError("can't read " + face.file) }
  let base = CTFontCreateWithFontDescriptor(desc, face.size, nil)
  let varied = CTFontDescriptorCreateCopyWithVariation(CTFontCopyFontDescriptor(base), tag("wght") as CFNumber, CGFloat(face.weight))
  let font = CTFontCreateWithFontDescriptor(varied, face.size, nil)
  var glyphsOut: [[Int]] = []
  for ch in face.chars.unicodeScalars {
    var u = [UniChar](String(ch).utf16), g = [CGGlyph](repeating: 0, count: u.count)
    guard CTFontGetGlyphsForCharacters(font, &u, &g, u.count), g[0] != 0 else { continue }
    var adv = CGSize.zero
    CTFontGetAdvancesForGlyphs(font, .horizontal, &g, &adv, 1)
    let box = CTFontGetBoundingRectsForGlyphs(font, .horizontal, &g, nil, 1)
    let x0 = Int(floor(box.minX)) - 1, y0 = Int(floor(box.minY)) - 1
    let w = max(0, Int(ceil(box.maxX)) + 1 - x0), h = max(0, Int(ceil(box.maxY)) + 1 - y0)
    var cell = [UInt8](repeating: 0, count: max(1, w * h))
    if w > 0 && h > 0 {
      let ctx = CGContext(data: &cell, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
      ctx.setAllowsFontSmoothing(false)
      ctx.setShouldAntialias(true)
      ctx.setFillColor(gray: 1, alpha: 1)
      var pos = CGPoint(x: -CGFloat(x0), y: -CGFloat(y0))
      CTFontDrawGlyphs(font, &g, &pos, 1, ctx)
    }
    // [code, advance x 64, left, top (pixels above the baseline), width, height, offset]
    glyphsOut.append([Int(ch.value), Int((adv.width * 64).rounded()), x0, y0 + h, w, h, bytes.count])
    if w > 0 && h > 0 { bytes.append(contentsOf: cell) }
  }
  meta.append(["id": face.id, "size": Double(face.size), "ascent": Double(CTFontGetAscent(font)),
               "descent": Double(CTFontGetDescent(font)), "glyphs": glyphsOut])
}

try! JSONSerialization.data(withJSONObject: meta).write(to: out.appendingPathComponent("og-font.json"))
try! bytes.write(to: out.appendingPathComponent("og-font.bin"))
print("faces", faces.count, "bytes", bytes.count)
