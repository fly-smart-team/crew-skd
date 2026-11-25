@testable import LogbookCore
import XCTest

/// 회사 Flight Log(2026/11) 실제 줄과 비교
final class LogbookTests: XCTestCase {
    let db = AirportDatabase.standard
    let opts = FlightCalcOptions()

    func entry(_ from: String, _ to: String, out: Date, inn: Date, off: Date? = nil, on: Date? = nil,
               pf: Bool = true) -> LogEntryRecord {
        var e = LogEntryRecord(aircraftType: "A321", originICAO: db.airport(from)!.icao, destinationICAO: db.airport(to)!.icao,
                               outUTC: out, offUTC: off, onUTC: on, inUTC: inn)
        FlightCalculator.recalculate(&e, airports: db, options: opts, pilotFlying: pf)
        return e
    }

    func testCompanyRowBlockTimeAndDate() {
        // 2026/11/01 ICN-CTS R/O 10/31 23:02, R/I 11/01 01:42, Duty time 2:40
        let e = entry("ICN", "CTS", out: Fixtures.utc(2026, 10, 31, 23, 2), inn: Fixtures.utc(2026, 11, 1, 1, 42))
        XCTAssertEqual(e.blockMinutes, 160)
        XCTAssertEqual(e.logDate, "2026-11-01") // 회사 로그북과 같은 한국 날짜
    }

    func testNightFlightIcnSgn() {
        // 2026/11/10 ICN-SGN R/O 10:32Z (19:32 KST) R/I 16:13Z → 전 구간 야간
        let e = entry("ICN", "SGN", out: Fixtures.utc(2026, 11, 10, 10, 32), inn: Fixtures.utc(2026, 11, 10, 16, 13))
        XCTAssertEqual(e.blockMinutes, 341)
        XCTAssertGreaterThanOrEqual(e.nightMinutes, 335)
        XCTAssertEqual(e.nightTakeoffs, 1)
        XCTAssertEqual(e.nightLandings, 1)
    }

    func testDuskFlightTpeIcn() {
        // 2026/11/04 TPE-ICN 09:05Z(17:05 대만) 출발 → 도중에 어두워짐. 회사 N/T 1:45
        let e = entry("TPE", "ICN", out: Fixtures.utc(2026, 11, 4, 9, 5), inn: Fixtures.utc(2026, 11, 4, 11, 32))
        XCTAssertEqual(e.blockMinutes, 147)
        XCTAssertTrue((95...130).contains(e.nightMinutes), "night=\(e.nightMinutes)")
        XCTAssertEqual(e.nightTakeoffs, 0)
        XCTAssertEqual(e.nightLandings, 1)
    }

    func testTakeoffOnlyNightLanding() {
        // TPE-ICN: 이륙만 내가 함 → 이륙 1(주간), 착륙 0
        var e = LogEntryRecord(originICAO: "RCTP", destinationICAO: "RKSI",
                               outUTC: Fixtures.utc(2026, 11, 4, 9, 5), inUTC: Fixtures.utc(2026, 11, 4, 11, 32))
        FlightCalculator.recalculate(&e, airports: db, options: opts, takeoff: true, landing: false)
        XCTAssertEqual([e.takeoffs, e.nightTakeoffs, e.landings, e.nightLandings], [1, 0, 0, 0])
        FlightCalculator.recalculate(&e, airports: db, options: opts, takeoff: false, landing: true)
        XCTAssertEqual([e.takeoffs, e.landings, e.nightLandings], [0, 1, 1])
    }

    func testSolarElevationSanity() {
        // 인천 하지 정오 무렵 고도 ~76°, 자정 무렵 음수
        let noon = SolarCalculator.elevation(at: Fixtures.utc(2026, 6, 21, 3, 35), latitude: 37.46, longitude: 126.44)
        XCTAssertEqual(noon, 76, accuracy: 1.5)
        let midnight = SolarCalculator.elevation(at: Fixtures.utc(2026, 6, 21, 15, 35), latitude: 37.46, longitude: 126.44)
        XCTAssertLessThan(midnight, -20)
    }

    func testRecency() {
        let asOf = Fixtures.utc(2026, 11, 25, 6, 0)
        var recs = [
            entry("ICN", "CTS", out: Fixtures.utc(2026, 8, 20, 0, 0), inn: Fixtures.utc(2026, 8, 20, 2, 30)), // 90일 밖
            entry("GMP", "CJU", out: Fixtures.utc(2026, 11, 14, 1, 6), inn: Fixtures.utc(2026, 11, 14, 2, 20)),
            entry("CJU", "GMP", out: Fixtures.utc(2026, 11, 14, 3, 9), inn: Fixtures.utc(2026, 11, 14, 4, 23)),
            entry("GMP", "KIX", out: Fixtures.utc(2026, 11, 14, 23, 29), inn: Fixtures.utc(2026, 11, 15, 1, 9), pf: false),
        ]
        var s = RecencyCalculator.status(recs, asOf: asOf)
        XCTAssertEqual(s.flightTakeoffs, 2)
        XCTAssertFalse(s.isCurrent)
        XCTAssertNil(s.validUntil)

        recs.append(LogEntryRecord(logDate: "2026-10-30", takeoffs: 3, landings: 3, isSimulator: true))
        s = RecencyCalculator.status(recs, asOf: asOf)
        XCTAssertEqual(s.simLandings, 3)
        XCTAssertTrue(s.isCurrent)
        XCTAssertNotNil(s.validUntil)
    }

    func testTotalsWithCarryForward() {
        let carry = CarryForward(totalMinutes: 8584 * 60 + 14, picMinutes: 1954 * 60 + 12, asOfDate: "2026-11-21")
        let old = entry("ICN", "CSX", out: Fixtures.utc(2026, 11, 20, 12, 9), inn: Fixtures.utc(2026, 11, 20, 15, 36))
        var new = entry("ICN", "SGN", out: Fixtures.utc(2026, 11, 24, 23, 19), inn: Fixtures.utc(2026, 11, 25, 5, 4))
        new.duty = "C"
        let t = LogTotals.compute([old, new], carry: carry)
        XCTAssertEqual(t.totalMinutes, 8584 * 60 + 14 + 345) // 누계 이전 기록(old)은 중복 합산 안 함
        XCTAssertEqual(t.picMinutes, 1954 * 60 + 12 + 345)
        XCTAssertEqual(t.flights, 1)

        let month = LogTotals.compute([old, new], from: "2026-11-01", through: "2026-11-30")
        XCTAssertEqual(month.totalMinutes, 207 + 345)
    }

    func testBackupRoundTripAndMerge() throws {
        let a = entry("ICN", "CTS", out: Fixtures.utc(2026, 10, 31, 23, 2), inn: Fixtures.utc(2026, 11, 1, 1, 42))
        let data = try LogbookBackup(carryForward: CarryForward(totalMinutes: 100), entries: [a]).encoded()
        let back = try LogbookBackup.decode(data)
        XCTAssertEqual(back.entries.first?.id, a.id)
        XCTAssertEqual(back.entries.first?.outUTC, a.outUTC)
        XCTAssertEqual(back.carryForward?.totalMinutes, 100)

        var edited = a
        edited.remarks = "고침"
        edited.updatedAt = a.updatedAt.addingTimeInterval(60)
        let fresh = LogEntryRecord(logDate: "2026-11-02")
        let plan = BackupMerge.plan(existing: [a], incoming: [edited, fresh])
        XCTAssertEqual(plan.update.map(\.remarks), ["고침"])
        XCTAssertEqual(plan.insert.count, 1)
    }

    func testCompanyCSV() {
        var e = entry("ICN", "CTS", out: Fixtures.utc(2026, 10, 31, 23, 2), inn: Fixtures.utc(2026, 11, 1, 1, 42),
                      off: Fixtures.utc(2026, 10, 31, 23, 20), on: Fixtures.utc(2026, 11, 1, 1, 27))
        e.flightNumber = "OZ174"; e.registration = "HL8399"; e.remarks = "a, b"
        let csv = CompanyCSV.make([e])
        let row = csv.split(separator: "\r\n")[1]
        XCTAssertTrue(row.hasPrefix("2026/11/01,A321,HL8399,OZ174,ICN-CTS,,C,10/31 23:02,11/01 01:42,2:40,2:07,"), String(row))
        XCTAssertTrue(row.hasSuffix(",*,*,2320,0127,,\"a, b\""), String(row))
    }

    func testTimeText() {
        XCTAssertEqual(TimeText.hmm(345), "5:45")
        XCTAssertEqual(TimeText.parseHMM("5:45"), 345)
        XCTAssertEqual(TimeText.parseHMM("0545"), 345)
        XCTAssertNil(TimeText.parseHMM("0575"))
    }
}
