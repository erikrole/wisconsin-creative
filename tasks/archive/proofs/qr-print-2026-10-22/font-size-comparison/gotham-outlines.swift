import Foundation
import CoreText
import CoreGraphics

let url=URL(fileURLWithPath:"/Users/role/Library/Fonts/GothamXNarrow-Bold.otf")
guard let descriptors=CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let descriptor=descriptors.first else { fatalError("Cannot read the requested Gotham font") }
let fontSize:CGFloat=21
let font=CTFontCreateWithFontDescriptor(descriptor,fontSize,nil)
let name=CTFontCopyPostScriptName(font) as String
guard name=="GothamXNarrow-Bold" else { fatalError("Unexpected font: \(name)") }
var lines:[[String:Any]]=[]
for text in ["FB","FX3","1"] {
  let chars=Array(text.utf16)
  var glyphs=[CGGlyph](repeating:0,count:chars.count)
  guard CTFontGetGlyphsForCharacters(font,chars,&glyphs,chars.count) else { fatalError("Missing Gotham glyph") }
  var advances=[CGSize](repeating:.zero,count:glyphs.count)
  CTFontGetAdvancesForGlyphs(font,.horizontal,glyphs,&advances,glyphs.count)
  var glyphData:[[String:Any]]=[]
  var x:CGFloat=0
  for (index,glyph) in glyphs.enumerated() {
    guard let path=CTFontCreatePathForGlyph(font,glyph,nil) else { fatalError("Missing glyph outline") }
    var commands=""
    path.applyWithBlock { pointer in
      let e=pointer.pointee
      func point(_ i:Int)->String { "\(e.points[i].x),\(-e.points[i].y)" }
      switch e.type {
      case .moveToPoint: commands+="M"+point(0)
      case .addLineToPoint: commands+="L"+point(0)
      case .addQuadCurveToPoint: commands+="Q"+point(0)+" "+point(1)
      case .addCurveToPoint: commands+="C"+point(0)+" "+point(1)+" "+point(2)
      case .closeSubpath: commands+="Z"
      @unknown default: fatalError("Unknown outline command")
      }
    }
    glyphData.append(["glyph":glyph,"x":x,"path":commands])
    x+=advances[index].width
  }
  lines.append(["text":text,"advance":x,"glyphs":glyphData])
}
let result:[String:Any]=["postScriptName":name,"family":CTFontCopyFamilyName(font) as String,"fontFile":url.path,"sizePx":fontSize,"capHeight":CTFontGetCapHeight(font),"lines":lines]
let data=try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys])
try data.write(to:URL(fileURLWithPath:"/private/tmp/qr-print-audit-evidence/direct-print-probe/gotham-outlines.json"))
print("Verified exact font outlines: \(name)")
