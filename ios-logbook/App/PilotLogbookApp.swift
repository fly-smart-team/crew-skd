import LogbookCore
import SwiftData
import SwiftUI

@main
struct PilotLogbookApp: App {
    @State private var settings = SettingsStore()
    let container: ModelContainer = Self.makeContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
        }
        .modelContainer(container)
    }

    /// 기록은 항상 이 iPad 안에 먼저 저장됩니다(오프라인 OK).
    /// iCloud에 로그인돼 있으면 CloudKit 비공개 데이터베이스로 자동 동기화됩니다.
    static func makeContainer() -> ModelContainer {
        let schema = Schema([FlightEntry.self, CustomAirport.self])
        do {
            let config = ModelConfiguration(schema: schema, cloudKitDatabase: .automatic)
            return try ModelContainer(for: schema, configurations: config)
        } catch {
            // iCloud 설정(entitlements)이 아직 없을 때 등: 기기 안에만 저장
            print("CloudKit 동기화 없이 시작합니다: \(error)")
            let local = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
            return try! ModelContainer(for: schema, configurations: local)
        }
    }
}

struct RootView: View {
    @Query private var customAirports: [CustomAirport]

    var body: some View {
        TabView {
            LogListView()
                .tabItem { Label("로그북", systemImage: "book.closed") }
            SummaryView()
                .tabItem { Label("요약", systemImage: "chart.bar") }
            SettingsView()
                .tabItem { Label("설정", systemImage: "gearshape") }
        }
        .environment(\.airports, AirportDatabase.standard.adding(customAirports.map(\.airport)))
    }
}

private struct AirportsKey: EnvironmentKey {
    static let defaultValue = AirportDatabase.standard
}

extension EnvironmentValues {
    var airports: AirportDatabase {
        get { self[AirportsKey.self] }
        set { self[AirportsKey.self] = newValue }
    }
}
