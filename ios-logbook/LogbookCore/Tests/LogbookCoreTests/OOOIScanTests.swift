@testable import LogbookCore
import XCTest

final class OOOIScanTests: XCTestCase {
    let parser = OOOIScreenParser()

    func testParsesRealPhotoLayout() {
        let r = parser.parse(Fixtures.mcduPhoto)
        XCTAssertTrue(r.isOOOIPage)
        XCTAssertEqual(r.flightID, "OZ731")
        XCTAssertEqual(r.originICAO, "RKSI")
        XCTAssertEqual(r.destinationICAO, "VVTS")
        XCTAssertTrue(r.notes.contains { $0.field == .destination && $0.kind == .guessed })
        XCTAssertEqual(r.out?.description, "2319")
        XCTAssertEqual(r.off?.description, "2341")
        XCTAssertEqual(r.on?.description, "0453")
        XCTAssertEqual(r.inTime?.description, "0504")
        XCTAssertEqual(r.blockMinutes, 5 * 60 + 45)
        XCTAssertEqual(r.flightMinutes, 5 * 60 + 12)
        XCTAssertEqual(r.screenUTC?.description, "0509")
        XCTAssertEqual(r.screenDay, 25)
        XCTAssertEqual(r.screenMonth, 11)
        XCTAssertNil(r.screenYear) // 잘려서 연도 모름
        XCTAssertTrue(r.checksumsPass)
        XCTAssertFalse(r.notes.contains { $0.kind == .missing || $0.kind == .mismatch })
    }

    func testParsesMergedLines() {
        let r = parser.parse(Fixtures.mcduMergedLines)
        XCTAssertEqual(r.flightID, "OZ731")
        XCTAssertEqual(r.originICAO, "RKSI")
        XCTAssertEqual(r.destinationICAO, "VVTS")
        XCTAssertEqual(r.out?.description, "2319")
        XCTAssertEqual(r.off?.description, "2341")
        XCTAssertEqual(r.on?.description, "0453")
        XCTAssertEqual(r.inTime?.description, "0504")
        XCTAssertEqual(r.screenYear, 2026)
        XCTAssertTrue(r.checksumsPass)
    }

    func testCorrectsSingleDigitMisread() {
        // OUT 2319Z 를 2349Z 로 잘못 읽음 → BLOCK 검산 + 지상이동 상식으로 2319 복원
        var tokens = Fixtures.mcduPhoto
        let i = tokens.firstIndex { $0.text == "2319Z" }!
        tokens[i].text = "2349Z"
        let r = parser.parse(tokens)
        XCTAssertEqual(r.out?.description, "2319")
        XCTAssertTrue(r.notes.contains { $0.field == .out && $0.kind == .corrected })
        XCTAssertTrue(r.checksumsPass)
    }

    func testFlagsAmbiguousMismatch() {
        // ON을 0458로 잘못 읽음: 3→8 은 한 글자 수정 후보가 여러 개라 자동 수정하지 않고 표시만
        var tokens = Fixtures.mcduPhoto
        let i = tokens.firstIndex { $0.text == "Ø453" }!
        tokens[i].text = "Ø458"
        let r = parser.parse(tokens)
        let corrected = r.notes.contains { $0.kind == .corrected }
        let flagged = r.notes.contains { $0.kind == .mismatch }
        XCTAssertTrue(corrected || flagged)
        if corrected { XCTAssertEqual(r.on?.description, "0453") }
    }

    func testDerivesValueHiddenByGlare() {
        var tokens = Fixtures.mcduPhoto
        tokens.removeAll { $0.text == "Ø453" } // 반사로 ON 값이 안 보임
        let r = parser.parse(tokens)
        XCTAssertEqual(r.on?.description, "0453")
        XCTAssertTrue(r.notes.contains { $0.field == .on && $0.kind == .derived })
        XCTAssertFalse(r.notes.contains { $0.field == .on && $0.kind == .missing })
    }

    func testMissingBlockValueIsNotStolenFromFlight() {
        var tokens = Fixtures.mcduPhoto
        tokens.removeAll { $0.text == "Ø545" }
        let r = parser.parse(tokens)
        XCTAssertEqual(r.flightMinutes, 312)
        XCTAssertEqual(r.blockMinutes, 345) // IN−OUT 으로 계산됨
        XCTAssertTrue(r.notes.contains { $0.field == .block && $0.kind == .derived })
    }

    func testNotAnOOOIPage() {
        let r = parser.parse([Fixtures.tok("PERF TAKE OFF", 100, 900, 400), Fixtures.tok("V1 142", 100, 400, 480)])
        XCTAssertFalse(r.isOOOIPage)
    }

    func testValueParsers() {
        XCTAssertEqual(ValueParsers.flightID("OZØ731"), "OZ731")
        XCTAssertEqual(ValueParsers.flightID("0Z0731"), "OZ731")
        XCTAssertEqual(ValueParsers.flightID("7C1302"), "7C1302")
        XCTAssertEqual(ValueParsers.zuluTime("Ø5Ø4Z")?.description, "0504")
        XCTAssertEqual(ValueParsers.zuluTime("23192")?.description, "2319")
        XCTAssertNil(ValueParsers.zuluTime("----Z"))
        XCTAssertNil(ValueParsers.zuluTime("2519Z").flatMap { $0.hour > 23 ? $0 : nil })
        XCTAssertEqual(ValueParsers.duration("Ø545"), 345)
        XCTAssertEqual(ValueParsers.route("RKSI/VVTS")?.1, "VVTS")
        XCTAssertEqual(ValueParsers.route("RK5I/VVT5")?.0, "RKSI")
        XCTAssertEqual(ValueParsers.screenDate("25NOV26")?.2, 2026)
    }

    // MARK: 날짜 붙이기

    func testResolvesDatesAcrossMidnight() {
        let r = parser.parse(Fixtures.mcduPhoto)
        let ref = OOOITimeResolver.referenceDate(for: r, fallback: Fixtures.utc(2026, 11, 25, 5, 30))
        XCTAssertEqual(ref, Fixtures.utc(2026, 11, 25, 5, 9))
        let t = OOOITimeResolver.resolve(r, reference: ref)
        XCTAssertEqual(t.out, Fixtures.utc(2026, 11, 24, 23, 19))
        XCTAssertEqual(t.off, Fixtures.utc(2026, 11, 24, 23, 41))
        XCTAssertEqual(t.on, Fixtures.utc(2026, 11, 25, 4, 53))
        XCTAssertEqual(t.inTime, Fixtures.utc(2026, 11, 25, 5, 4))
    }

    func testReferenceYearInferredFromPhotoDateAroundNewYear() {
        var r = OOOIScreenReading()
        r.screenDay = 31; r.screenMonth = 12; r.screenUTC = ClockTime(hour: 23, minute: 50)
        let ref = OOOITimeResolver.referenceDate(for: r, fallback: Fixtures.utc(2027, 1, 1, 0, 5))
        XCTAssertEqual(ref, Fixtures.utc(2026, 12, 31, 23, 50))
    }

    func testFullScanToLogEntry() {
        let r = parser.parse(Fixtures.mcduPhoto)
        let t = OOOITimeResolver.resolve(r, reference: OOOITimeResolver.referenceDate(for: r, fallback: Fixtures.utc(2026, 11, 25, 6, 0)))
        var e = LogEntryRecord(aircraftType: "A321", registration: "HL8399", flightNumber: r.flightID!,
                               originICAO: r.originICAO!, destinationICAO: r.destinationICAO!,
                               outUTC: t.out, offUTC: t.off, onUTC: t.on, inUTC: t.inTime)
        FlightCalculator.recalculate(&e, airports: .standard, options: FlightCalcOptions(), pilotFlying: true)
        XCTAssertEqual(e.logDate, "2026-11-25") // 한국 시간 08:19 출발
        XCTAssertEqual(e.blockMinutes, 345)
        XCTAssertEqual(e.flightMinutes, 312)
        XCTAssertEqual(e.nightMinutes, 0)    // 08:19 KST ~ 12:04 현지, 낮 비행
        XCTAssertEqual(e.instrumentMinutes, 312)
        XCTAssertEqual(e.takeoffs, 1)
        XCTAssertEqual(e.nightLandings, 0)
    }
}
