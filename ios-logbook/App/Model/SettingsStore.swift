import Foundation
import LogbookCore
import Observation

/// 앱 설정. 이 기기(UserDefaults)에 저장하고, iCloud 키-값 저장소로 다른 기기와 맞춥니다.
@Observable
final class SettingsStore {
    var logTimeZoneID: String { didSet { save(Key.logTimeZoneID, logTimeZoneID) } }
    var nightDefinition: NightDefinition { didSet { save(Key.nightDefinition, nightDefinition.rawValue) } }
    var instrumentRule: InstrumentRule { didSet { save(Key.instrumentRule, instrumentRule.rawValue) } }
    var defaultAircraftType: String { didSet { save(Key.aircraftType, defaultAircraftType) } }
    var defaultDuty: String { didSet { save(Key.duty, defaultDuty) } }
    var carryForward: CarryForward { didSet { saveCarry() } }

    @ObservationIgnored private let kvs = NSUbiquitousKeyValueStore.default
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var observer: NSObjectProtocol?

    private enum Key {
        static let logTimeZoneID = "logTimeZoneID"
        static let nightDefinition = "nightDefinition"
        static let instrumentRule = "instrumentRule"
        static let aircraftType = "defaultAircraftType"
        static let duty = "defaultDuty"
        static let carry = "carryForward"
    }

    init() {
        kvs.synchronize()
        logTimeZoneID = Self.string(Key.logTimeZoneID) ?? "Asia/Seoul"
        nightDefinition = Self.string(Key.nightDefinition).flatMap(NightDefinition.init(rawValue:)) ?? .civilTwilight
        instrumentRule = Self.string(Key.instrumentRule).flatMap(InstrumentRule.init(rawValue:)) ?? .flightTime
        defaultAircraftType = Self.string(Key.aircraftType) ?? "A321"
        defaultDuty = Self.string(Key.duty) ?? "C"
        carryForward = Self.carry() ?? CarryForward()

        observer = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: kvs, queue: .main
        ) { [weak self] _ in self?.reloadFromCloud() }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    var logTimeZone: TimeZone { TimeZone(identifier: logTimeZoneID) ?? TimeZone(identifier: "Asia/Seoul")! }

    var calcOptions: FlightCalcOptions {
        FlightCalcOptions(nightDefinition: nightDefinition, instrumentRule: instrumentRule, logDateTimeZone: logTimeZone)
    }

    // MARK: 저장

    private func save(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        kvs.set(value, forKey: key)
    }

    private func saveCarry() {
        guard let data = try? JSONEncoder().encode(carryForward) else { return }
        defaults.set(data, forKey: Key.carry)
        kvs.set(data, forKey: Key.carry)
    }

    private static func string(_ key: String) -> String? {
        NSUbiquitousKeyValueStore.default.string(forKey: key) ?? UserDefaults.standard.string(forKey: key)
    }

    private static func carry() -> CarryForward? {
        let data = NSUbiquitousKeyValueStore.default.data(forKey: Key.carry) ?? UserDefaults.standard.data(forKey: Key.carry)
        return data.flatMap { try? JSONDecoder().decode(CarryForward.self, from: $0) }
    }

    private func reloadFromCloud() {
        if let v = Self.string(Key.logTimeZoneID), v != logTimeZoneID { logTimeZoneID = v }
        if let v = Self.string(Key.nightDefinition).flatMap(NightDefinition.init(rawValue:)), v != nightDefinition { nightDefinition = v }
        if let v = Self.string(Key.instrumentRule).flatMap(InstrumentRule.init(rawValue:)), v != instrumentRule { instrumentRule = v }
        if let v = Self.string(Key.aircraftType), v != defaultAircraftType { defaultAircraftType = v }
        if let v = Self.string(Key.duty), v != defaultDuty { defaultDuty = v }
        if let v = Self.carry(), v != carryForward { carryForward = v }
    }
}
