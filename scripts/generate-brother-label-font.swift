import Foundation
import CoreText
import CoreGraphics
// Run on macOS: swift scripts/generate-brother-label-font.swift /path/to/GothamXNarrow-Bold.otf public/GothamXNarrow-Bold.outlines.json
// Exports exact glyph geometry; no platform font lookup or substitution at print time.
guard CommandLine.arguments.count == 3 else { fatalError("Pass the licensed Gotham font and output JSON paths") }
let url=URL(fileURLWithPath:CommandLine.arguments[1])
let descriptors=CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as! [CTFontDescriptor]
let font=CTFontCreateWithFontDescriptor(descriptors[0],21,nil)
let name=CTFontCopyPostScriptName(font) as String
precondition(name=="GothamXNarrow-Bold")
var chars:[String:Any]=[:]
for code in 32...65533 {
  if (0xD800...0xDFFF).contains(code) {continue}
  var char=UniChar(code),glyph=CGGlyph(0)
  if !CTFontGetGlyphsForCharacters(font,&char,&glyph,1) || glyph==0 {continue}
  var advance=CGSize.zero
  CTFontGetAdvancesForGlyphs(font,.horizontal,&glyph,&advance,1)
  var commands=""
  if let path=CTFontCreatePathForGlyph(font,glyph,nil) {
    path.applyWithBlock { pointer in
      let e=pointer.pointee
      func point(_ i:Int)->String { "\(e.points[i].x),\(-e.points[i].y)" }
      switch e.type {
      case .moveToPoint: commands+="M"+point(0)
      case .addLineToPoint: commands+="L"+point(0)
      case .addQuadCurveToPoint: commands+="Q"+point(0)+" "+point(1)
      case .addCurveToPoint: commands+="C"+point(0)+" "+point(1)+" "+point(2)
      case .closeSubpath: commands+="Z"
      @unknown default: fatalError("Unknown command")
      }
    }
  }
  chars[String(UnicodeScalar(code)!)]=["advance":advance.width,"path":commands]
}
let result:[String:Any]=["postScriptName":name,"sizePx":21,"glyphs":chars]
let data=try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys])
try data.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
print("Exported \(chars.count) characters of \(name), \(data.count) bytes")
