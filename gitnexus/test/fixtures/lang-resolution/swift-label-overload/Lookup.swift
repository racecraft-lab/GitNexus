class LookupService {
    func find(id: String) -> String {
        return "id"
    }

    func find(name: String) -> String {
        return "name"
    }

    func perform(action: () -> Void) {
        action()
    }

    func finish() {}
}

func runLookup() {
    let lookup = LookupService()
    lookup.find(id: "42")
    lookup.find(name: "fred")
    lookup.perform {
        lookup.finish()
    }
}
