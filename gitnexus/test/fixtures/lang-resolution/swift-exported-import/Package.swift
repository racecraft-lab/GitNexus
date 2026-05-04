// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ExportedImportFixture",
    targets: [
        .target(name: "Models"),
        .target(name: "Barrel", dependencies: ["Models"]),
        .executableTarget(name: "App", dependencies: ["Barrel"])
    ]
)
