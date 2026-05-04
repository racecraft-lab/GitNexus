// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CustomTargets",
    targets: [
        .target(
            name: "Core",
            path: "Modules/Core"
        ),
        .executableTarget(
            name: "App",
            dependencies: ["Core"],
            path: "Apps/App"
        )
    ]
)
