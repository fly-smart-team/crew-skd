import Foundation
import LogbookCore
import SwiftData

/// 저장되는 로그북 한 줄.
/// 아이패드 안에 먼저 저장되고, iCloud에 로그인돼 있으면 CloudKit으로 자동 동기화됩니다.
/// (CloudKit 규칙상 모든 속성에 기본값이 있어야 하고 unique 제약을 쓸 수 없습니다.)
@Model
final class FlightEntry {
    var id: UUID = UUID()
    var logDate: String = ""
    var aircraftType: String = ""
    var registration: String = ""
    var flightNumber: String = ""
    var originICAO: String = ""
    var destinationICAO: String = ""
    var irregular: String = ""
    var duty: String = "C"
    var outUTC: Date?
    var offUTC: Date?
    var onUTC: Date?
    var inUTC: Date?
    var blockMinutes: Int = 0
    var flightMinutes: Int = 0
    var nightMinutes: Int = 0
    var instrumentMinutes: Int = 0
    var takeoffs: Int = 0
    var landings: Int = 0
    var nightTakeoffs: Int = 0
    var nightLandings: Int = 0
    var isSimulator: Bool = false
    var remarks: String = ""
    var source: String = "manual"
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    /// 야간·계기 시간을 직접 고쳤으면 자동 계산이 덮어쓰지 않음
    var nightManual: Bool = false
    var instrumentManual: Bool = false
    /// OOOI 화면 사진 (증빙용). iCloud에는 별도 파일로 올라감
    @Attribute(.externalStorage) var scanImage: Data?

    init() {}

    var record: LogEntryRecord {
        LogEntryRecord(id: id, logDate: logDate, aircraftType: aircraftType, registration: registration,
                       flightNumber: flightNumber, originICAO: originICAO, destinationICAO: destinationICAO,
                       irregular: irregular, duty: duty,
                       outUTC: outUTC, offUTC: offUTC, onUTC: onUTC, inUTC: inUTC,
                       blockMinutes: blockMinutes, flightMinutes: flightMinutes,
                       nightMinutes: nightMinutes, instrumentMinutes: instrumentMinutes,
                       takeoffs: takeoffs, landings: landings,
                       nightTakeoffs: nightTakeoffs, nightLandings: nightLandings,
                       isSimulator: isSimulator, remarks: remarks, source: source,
                       createdAt: createdAt, updatedAt: updatedAt)
    }

    func apply(_ r: LogEntryRecord) {
        id = r.id
        logDate = r.logDate
        aircraftType = r.aircraftType
        registration = r.registration
        flightNumber = r.flightNumber
        originICAO = r.originICAO
        destinationICAO = r.destinationICAO
        irregular = r.irregular
        duty = r.duty
        outUTC = r.outUTC
        offUTC = r.offUTC
        onUTC = r.onUTC
        inUTC = r.inUTC
        blockMinutes = r.blockMinutes
        flightMinutes = r.flightMinutes
        nightMinutes = r.nightMinutes
        instrumentMinutes = r.instrumentMinutes
        takeoffs = r.takeoffs
        landings = r.landings
        nightTakeoffs = r.nightTakeoffs
        nightLandings = r.nightLandings
        isSimulator = r.isSimulator
        remarks = r.remarks
        source = r.source
        createdAt = r.createdAt
        updatedAt = r.updatedAt
    }
}

/// 기본 목록에 없는 공항 (설정에서 추가)
@Model
final class CustomAirport {
    var icao: String = ""
    var iata: String = ""
    var latitude: Double = 0
    var longitude: Double = 0
    var timeZoneID: String = "UTC"

    init(icao: String = "", iata: String = "", latitude: Double = 0, longitude: Double = 0, timeZoneID: String = "UTC") {
        self.icao = icao
        self.iata = iata
        self.latitude = latitude
        self.longitude = longitude
        self.timeZoneID = timeZoneID
    }

    var airport: Airport {
        Airport(icao: icao, iata: iata, latitude: latitude, longitude: longitude, timeZoneID: timeZoneID)
    }
}
