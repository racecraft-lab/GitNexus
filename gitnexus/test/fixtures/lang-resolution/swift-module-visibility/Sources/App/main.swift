import Models

func runApp() {
    let service = PublicService()
    service.doWork()
    publicHelper()
    internalHelper()
    secretHelper()
    fileOnlyHelper()
}
