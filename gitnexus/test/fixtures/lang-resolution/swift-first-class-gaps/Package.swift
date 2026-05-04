// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SwiftFirstClassGaps",
  products: [
    .library(name: "AvailableKit", targets: ["AvailableKit"]),
    .executable(name: "App", targets: ["App"]),
  ],
  targets: [
    .target(name: "AvailableKit", path: "Sources/AvailableKit"),
    .executableTarget(name: "App", dependencies: ["AvailableKit"], path: "Sources/App"),
  ]
)
