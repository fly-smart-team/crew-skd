import LogbookCore
import SwiftData
import SwiftUI

/// 회사 Flight Log의 "Flight Summary"와 "Recent 90 days" 표에 해당하는 화면
struct SummaryView: View {
    @Environment(SettingsStore.self) private var settings
    @Query private var entries: [FlightEntry]

    var body: some View {
        let records = entries.map(\.record)
        let total = LogTotals.compute(records, carry: settings.carryForward)
        let monthStart = String(LogDate.string(for: Date(), in: settings.logTimeZone).prefix(7)) + "-01"
        let month = LogTotals.compute(records, from: monthStart)
        let recency = RecencyCalculator.status(records, asOf: Date())

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    recencyCard(recency)

                    SummaryGroup(title: "누계 (Flight Summary)") {
                        Stat(title: "총 비행시간", value: TimeText.hmm(total.totalMinutes))
                        Stat(title: "기장(CAP) 시간", value: TimeText.hmm(total.picMinutes))
                        Stat(title: "야간", value: TimeText.hmm(total.nightMinutes))
                        Stat(title: "계기", value: TimeText.hmm(total.instrumentMinutes))
                    }
                    if settings.carryForward.totalMinutes == 0 {
                        Text("설정 > 이월 누계에 회사 Flight Summary 숫자를 넣으면 총 시간이 맞춰집니다.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }

                    SummaryGroup(title: "이번 달") {
                        Stat(title: "비행시간", value: TimeText.hmm(month.totalMinutes))
                        Stat(title: "편수", value: "\(month.flights)")
                        Stat(title: "야간", value: TimeText.hmm(month.nightMinutes))
                        Stat(title: "이착륙", value: "\(month.takeoffs) / \(month.landings)")
                    }
                }
                .padding()
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("요약")
        }
    }

    private func recencyCard(_ r: RecencyStatus) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("최근 90일 이착륙").font(.headline)
                Spacer()
                Label(r.isCurrent ? "요건 충족" : "요건 미달 (각 \(r.required)회)",
                      systemImage: r.isCurrent ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(r.isCurrent ? .green : .orange)
                    .font(.subheadline.weight(.semibold))
            }
            Grid(alignment: .trailing, horizontalSpacing: 24, verticalSpacing: 6) {
                GridRow {
                    Text("").gridColumnAlignment(.leading)
                    Text("비행"); Text("SIM"); Text("합계").bold()
                }
                .font(.caption).foregroundStyle(.secondary)
                GridRow {
                    Text("Take-off").gridColumnAlignment(.leading)
                    Text("\(r.flightTakeoffs)"); Text("\(r.simTakeoffs)"); Text("\(r.totalTakeoffs)").bold()
                }
                GridRow {
                    Text("Landing").gridColumnAlignment(.leading)
                    Text("\(r.flightLandings)"); Text("\(r.simLandings)"); Text("\(r.totalLandings)").bold()
                }
            }
            .monospacedDigit()
            if let until = r.validUntil {
                Text("추가 이착륙이 없으면 \(until.formatted(date: .long, time: .omitted))까지 유지")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if r.nightTakeoffs + r.nightLandings > 0 {
                Text("그중 야간: 이륙 \(r.nightTakeoffs) · 착륙 \(r.nightLandings)").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct SummaryGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) { content }
        }
    }
}

struct Stat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.semibold).monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
}
