// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VisibilityPackage",
    targets: [
        .target(name: "Models"),
        .executableTarget(name: "App", dependencies: ["Models"]),
        .testTarget(name: "ModelsTests", dependencies: ["Models"])
    ]
)
