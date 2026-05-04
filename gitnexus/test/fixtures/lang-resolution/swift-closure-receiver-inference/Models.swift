class User {
    func save() {}
}

func processClosures(users: [User]) {
    users.forEach { user in
        user.save()
    }

    users.map {
        $0.save()
    }
}
