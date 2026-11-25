@testable import LogbookCore
import Foundation

/// 실제 MCDU 사진(1126×2000, OZ731 RKSI→VVTS)에서 글자 위치를 재서 만든 OCR 결과.
/// 사진 오른쪽이 잘려 "VVTS"→"VVT", "25NOV26"→"25NOV2", "2341Z"→"2341" 로 읽히는 상황까지 재현.
enum Fixtures {
    static let w = 1126.0, h = 2000.0

    static func tok(_ text: String, _ x0: Double, _ x1: Double, _ yc: Double, height: Double = 52) -> OCRToken {
        OCRToken(text: text, minX: x0 / w, minY: (yc - height / 2) / h, maxX: x1 / w, maxY: (yc + height / 2) / h)
    }

    /// Vision이 칸마다 따로 잡은 경우
    static var mcduPhoto: [OCRToken] {
        [
            tok("AOC OOOI STATUS 1/3", 205, 1126, 462, height: 60),
            tok("FLIGHT ID", 75, 470, 545),
            tok("ORIG/DEST", 748, 1126, 545),
            tok("OZØ731", 75, 340, 617),
            tok("RKSI/VVT", 748, 1126, 617),
            tok("RETURN", 120, 385, 688),
            tok("UTC", 570, 695, 688),
            tok("DATE", 925, 1095, 688),
            tok("----Z", 80, 295, 762),
            tok("Ø5Ø9", 527, 697, 762),
            tok("25NOV2", 840, 1126, 755),
            tok("OUT", 125, 250, 835),
            tok("OFF", 975, 1095, 828),
            tok("2319Z", 80, 295, 908),
            tok("2341", 930, 1126, 902),
            tok("IN", 125, 210, 982),
            tok("←", 395, 440, 970),
            tok("ON", 1020, 1100, 975),
            tok("Ø5Ø4Z", 80, 295, 1055),
            tok("Ø453", 930, 1126, 1045),
            tok("BLOCK", 125, 345, 1127),
            tok("FLIGHT", 845, 1100, 1118),
            tok("Ø545", 85, 255, 1200),
            tok("Ø512", 935, 1105, 1188),
            tok("RETURN TO", 130, 525, 1268),
            tok("<AOC MENU", 85, 485, 1335, height: 64),
            tok("PRINT*", 890, 1126, 1328, height: 64),
            // 아래쪽 키패드 글씨 (헷갈리지 않아야 함)
            tok("PROG", 175, 315, 1665), tok("PERF", 400, 530, 1660),
            tok("INIT", 640, 740, 1658), tok("DATA", 850, 975, 1655),
            tok("FUEL", 400, 540, 1790), tok("PRED", 400, 540, 1835),
        ]
    }

    /// Vision이 한 줄을 통째로 하나로 묶은 경우
    static var mcduMergedLines: [OCRToken] {
        [
            tok("AOC OOOI STATUS 1/3", 205, 1126, 462, height: 60),
            tok("FLIGHT ID ORIG/DEST", 75, 1126, 545),
            tok("0Z0731 RKSI/VVTS", 75, 1126, 617),
            tok("RETURN UTC DATE", 120, 1095, 688),
            tok("----Z 0509 25NOV26", 80, 1126, 760),
            tok("OUT OFF", 125, 1095, 832),
            tok("2319Z 2341Z", 80, 1126, 905),
            tok("IN ON", 125, 1100, 978),
            tok("0504Z 0453Z", 80, 1126, 1050),
            tok("BLOCK FLIGHT", 125, 1100, 1122),
            tok("0545 0512", 85, 1105, 1194),
        ]
    }

    static func utc(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Date {
        TimeText.utcCalendar.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
    }
}
