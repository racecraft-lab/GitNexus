class RawLookupService {
    func find(_ raw: String) -> String {
        return "raw"
    }

    func find(id: String) -> String {
        return "id"
    }
}

func runRawLookup() {
    let lookup = RawLookupService()
    lookup.find("x")
}
