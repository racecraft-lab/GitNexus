// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "ModuleSelectorFixture",
    targets: [
        .target(name: "ModuleA"),
        .executableTarget(name: "App", dependencies: ["ModuleA"]),
    ]
)
