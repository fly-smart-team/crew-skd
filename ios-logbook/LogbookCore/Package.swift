// swift-tools-version:5.9
import PackageDescription

// LogbookCore: 화면(UI)과 상관없는 계산·해석 로직.
// iPad 앱(App/)이 이 패키지를 가져다 쓰고, Linux/Mac 어디서든 `swift test`로 검증할 수 있습니다.
let package = Package(
    name: "LogbookCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "LogbookCore", targets: ["LogbookCore"]),
    ],
    targets: [
        .target(name: "LogbookCore"),
        .testTarget(name: "LogbookCoreTests", dependencies: ["LogbookCore"]),
    ]
)
