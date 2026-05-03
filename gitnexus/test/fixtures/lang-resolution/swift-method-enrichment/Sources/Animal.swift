protocol Animal {
    func speak() -> String
}

@MainActor class Dog: Animal {
    @available(macOS 14, *) func speak() -> String {
        return "woof"
    }

    static func classify(_ name: String) -> String {
        return "mammal"
    }

    @objc final func breathe() -> Bool {
        return true
    }

    @SwiftUI.State var state: State
}
