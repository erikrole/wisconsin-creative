import XCTest
@testable import Wisconsin

final class ScoreboardModelsTests: XCTestCase {
    func testScoreboardDecodesServerShapeAndPreservesSeparateTotals() throws {
        let scoreboard = try JSONDecoder().decode(UserScoreboard.self, from: Data(scoreboardJSON.utf8))

        XCTAssertEqual(scoreboard.scope.label, "2026–27 season")
        XCTAssertEqual(scoreboard.summary.eventsWorked, 7)
        XCTAssertEqual(scoreboard.summary.recordLabel, "2–1")
        XCTAssertEqual(scoreboard.summary.winRateLabel, "66.7%")
        XCTAssertEqual(scoreboard.byVenue.first?.label, "Camp Randall Stadium")
        XCTAssertEqual(scoreboard.byVenue.first?.recordLabel, "2–0")
        XCTAssertEqual(scoreboard.nextCursor, "25")

        XCTAssertEqual(scoreboard.nextOffset, 25)

        let event = try XCTUnwrap(scoreboard.events.first)
        XCTAssertEqual(event.resultLabel, "W")
        XCTAssertEqual(event.resultName, "Win")
        XCTAssertTrue(event.isWin)
        XCTAssertEqual(event.siteLabel, "Home")
        XCTAssertEqual(event.matchupLabel, "Football vs Iowa")
        XCTAssertEqual(event.venue, "Camp Randall Stadium")
        XCTAssertEqual(event.venueLabel, "Camp Randall Stadium")
        XCTAssertEqual(event.shiftAreas, ["VIDEO", "PHOTO"])
        // Areas are named the way the rest of the app names them, not
        // re-capitalized here.
        XCTAssertEqual(event.areasLabel, "Video, Photo")
        XCTAssertNotNil(event.startsDate)
    }

    func testFilteredEventsFallBackToReadableCopyAndSpokenResults() throws {
        let json = """
        {
          "id": "event-2",
          "startsAt": "2026-09-12T00:00:00.000Z",
          "allDay": true,
          "result": "LOSS",
          "sportCode": null,
          "sportLabel": null,
          "opponent": "  ",
          "site": null,
          "venue": "   ",
          "shiftAreas": []
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(ScoreboardEvent.self, from: json)

        XCTAssertEqual(event.resultLabel, "L")
        XCTAssertEqual(event.resultName, "Loss")
        XCTAssertFalse(event.isWin)
        XCTAssertEqual(event.matchupLabel, "Worked event")
        XCTAssertEqual(event.siteLabel, "Site unknown")
        XCTAssertEqual(event.venueLabel, "Venue not recorded")
        XCTAssertNil(event.areasLabel)
        XCTAssertTrue(event.allDay)
    }

    func testTieResultsDecodeWithNeutralPresentation() throws {
        let event = game(id: "event-tie", starts: "2026-09-13T00:00:00.000Z", result: "TIE")
        XCTAssertEqual(event.resultLabel, "T")
        XCTAssertEqual(event.resultName, "Tie")
        XCTAssertFalse(event.isWin)
        XCTAssertTrue(event.isTie)

        let summaryJSON = """
        {"eventsWorked":2,"wins":1,"losses":0,"ties":1,"games":2,"winRate":75}
        """.data(using: .utf8)!
        let summary = try JSONDecoder().decode(ScoreboardSummary.self, from: summaryJSON)
        XCTAssertEqual(summary.ties, 1)
        XCTAssertEqual(summary.games, 2)
        XCTAssertEqual(summary.recordLabel, "1–0–1")
    }

    /// The cursor is an offset. A cursor that is not one has to end the list
    /// rather than read as zero and serve page one again.
    func testNonNumericCursorEndsPagination() throws {
        let json = """
        {
          "scope": {
            "key": "2026-27",
            "label": "2026–27 season",
            "startsAt": "2026-07-01T00:00:00.000Z",
            "endsAt": "2027-07-01T00:00:00.000Z",
            "timeZone": "America/Chicago"
          },
          "summary": { "eventsWorked": 1, "wins": 1, "losses": 0, "games": 1, "winRate": 100 },
          "nextCursor": "opaque-cursor"
        }
        """.data(using: .utf8)!

        let scoreboard = try JSONDecoder().decode(UserScoreboard.self, from: json)

        XCTAssertEqual(scoreboard.nextCursor, "opaque-cursor")
        XCTAssertNil(scoreboard.nextOffset)
        XCTAssertEqual(scoreboard.summary.winRateLabel, "100%")
    }

    /// One owner for the record wording, so a bucket row and the season summary
    /// can never spell the same record two ways.
    func testRecordAndRateFormattingIsShared() {
        XCTAssertEqual(ScoreboardFormat.record(wins: 4, losses: 2), "4–2")
        XCTAssertEqual(ScoreboardFormat.record(wins: 4, losses: 2, ties: 1), "4–2–1")
        XCTAssertEqual(ScoreboardFormat.winRate(nil), "—")
        XCTAssertEqual(ScoreboardFormat.winRate(66.7), "66.7%")
        XCTAssertEqual(ScoreboardFormat.winRate(100), "100%")
        XCTAssertEqual(ScoreboardFormat.games(1), "1 game")
        XCTAssertEqual(ScoreboardFormat.games(3), "3 games")
    }

    func testScoreboardToleratesOptionalCollectionsAndNumericCursor() throws {
        let json = """
        {
          "scope": {
            "key": "2026-27",
            "label": "2026–27 season",
            "startsAt": "2026-07-01T00:00:00.000Z",
            "endsAt": "2027-07-01T00:00:00.000Z",
            "timeZone": "America/Chicago"
          },
          "summary": {
            "eventsWorked": 0,
            "wins": 0,
            "losses": 0,
            "games": 0,
            "winRate": null
          },
          "nextCursor": 25
        }
        """.data(using: .utf8)!

        let scoreboard = try JSONDecoder().decode(UserScoreboard.self, from: json)

        XCTAssertTrue(scoreboard.bySport.isEmpty)
        XCTAssertTrue(scoreboard.events.isEmpty)
        XCTAssertEqual(scoreboard.nextCursor, "25")
        XCTAssertEqual(scoreboard.nextOffset, 25)
        XCTAssertEqual(scoreboard.summary.winRateLabel, "—")
    }

    func testTeamScoreboardDecodesUniqueTotalsAndMinimalLeaderboardIdentity() throws {
        let json = """
        {
          "generatedAt": "2026-12-01T18:00:00.000Z",
          "scope": {
            "key": "2026-27", "label": "2026–27 season",
            "startsAt": "2026-07-01T00:00:00.000Z", "endsAt": "2027-07-01T00:00:00.000Z",
            "timeZone": "America/Chicago"
          },
          "methodology": {
            "eventsCovered": "Unique completed events.",
            "eventCredits": "One credit per person per event.",
            "record": "Unique resolved games.",
            "gameCredits": "One credit per person per game.",
            "minimumGamesForWinRate": 3
          },
          "filters": {
            "sportCode": "FB", "venue": "Camp Randall Stadium",
            "opponent": "Iowa", "site": "HOME"
          },
          "facets": {
            "sports": [{"key":"FB","label":"Football"}],
            "venues": [{"key":"Camp Randall Stadium","label":"Camp Randall Stadium"}],
            "opponents": [{"key":"Iowa","label":"Iowa"}],
            "sites": [{"key":"HOME","label":"Home"}]
          },
          "summary": {
            "contributors": 2, "eventsCovered": 4, "eventCredits": 7,
            "wins": 2, "losses": 1, "games": 3, "winRate": 66.7, "gameCredits": 5
          },
          "bySport": [{
            "key": "FB", "label": "Football", "contributors": 2,
            "eventsCovered": 3, "eventCredits": 5, "wins": 2, "losses": 1,
            "games": 3, "winRate": 66.7, "gameCredits": 5
          }],
          "byVenue": [{
            "key": "Camp Randall Stadium", "label": "Camp Randall Stadium", "contributors": 2,
            "eventsCovered": 3, "eventCredits": 5, "wins": 2, "losses": 1,
            "games": 3, "winRate": 66.7, "gameCredits": 5
          }],
          "byOpponent": [{
            "key": "Iowa", "label": "Iowa", "contributors": 2,
            "eventsCovered": 3, "eventCredits": 5, "wins": 2, "losses": 1,
            "games": 3, "winRate": 66.7, "gameCredits": 5
          }],
          "bySite": [{
            "key": "HOME", "label": "Home", "contributors": 2,
            "eventsCovered": 3, "eventCredits": 5, "wins": 2, "losses": 1,
            "games": 3, "winRate": 66.7, "gameCredits": 5
          }],
          "leaderboard": [{
            "userId": "user-1", "name": "Bucky Badger", "avatarUrl": null,
            "summary": {"eventsWorked": 3, "wins": 2, "losses": 1, "games": 3, "winRate": 66.7},
            "bySport": [{
              "key": "FB", "label": "Football", "eventsWorked": 3,
              "wins": 2, "losses": 1, "games": 3, "winRate": 66.7
            }]
          }]
        }
        """.data(using: .utf8)!

        let scoreboard = try JSONDecoder().decode(TeamScoreboard.self, from: json)

        XCTAssertEqual(scoreboard.summary.eventsCovered, 4)
        XCTAssertEqual(scoreboard.summary.eventCredits, 7)
        XCTAssertEqual(scoreboard.summary.recordLabel, "2–1")
        XCTAssertEqual(scoreboard.summary.winRateLabel, "66.7%")
        XCTAssertEqual(scoreboard.methodology.minimumGamesForWinRate, 3)
        XCTAssertEqual(scoreboard.filters.sportCode, "FB")
        XCTAssertEqual(scoreboard.filters.venue, "Camp Randall Stadium")
        XCTAssertEqual(scoreboard.facets.sports.first?.label, "Football")
        XCTAssertEqual(scoreboard.facets.venues.first?.key, "Camp Randall Stadium")
        XCTAssertEqual(scoreboard.bySport.first?.eventsCovered, 3)
        XCTAssertEqual(scoreboard.byVenue.first?.recordLabel, "2–1")
        XCTAssertEqual(scoreboard.byOpponent.first?.label, "Iowa")
        XCTAssertEqual(scoreboard.bySite.first?.label, "Home")
        XCTAssertEqual(scoreboard.leaderboard.first?.id, "user-1")
        XCTAssertEqual(scoreboard.leaderboard.first?.name, "Bucky Badger")
        XCTAssertEqual(scoreboard.leaderboard.first?.bySport.first?.recordLabel, "2–1")
    }

    func testTeamScoreboardToleratesRollingOptionalCollections() throws {
        let json = """
        {
          "scope": {
            "key": "2026-27", "label": "2026–27 season",
            "startsAt": "2026-07-01T00:00:00.000Z", "endsAt": "2027-07-01T00:00:00.000Z",
            "timeZone": "America/Chicago"
          },
          "summary": {
            "contributors": 0, "eventsCovered": 0, "eventCredits": 0,
            "wins": 0, "losses": 0, "games": 0, "winRate": null, "gameCredits": 0
          }
        }
        """.data(using: .utf8)!

        let scoreboard = try JSONDecoder().decode(TeamScoreboard.self, from: json)

        XCTAssertNil(scoreboard.generatedAt)
        XCTAssertEqual(scoreboard.filters, .empty)
        XCTAssertEqual(scoreboard.facets, .empty)
        XCTAssertTrue(scoreboard.bySport.isEmpty)
        XCTAssertTrue(scoreboard.byVenue.isEmpty)
        XCTAssertTrue(scoreboard.byOpponent.isEmpty)
        XCTAssertTrue(scoreboard.bySite.isEmpty)
        XCTAssertTrue(scoreboard.leaderboard.isEmpty)
        XCTAssertEqual(scoreboard.methodology.minimumGamesForWinRate, 3)
        XCTAssertEqual(scoreboard.summary.winRateLabel, "—")
    }

    // MARK: - Season shape

    func testMonthsGroupGamesInRouteOrder() {
        let games = [
            game(id: "a", starts: "2026-12-05T18:00:00.000Z", result: "WIN"),
            game(id: "b", starts: "2026-11-28T19:00:00.000Z", result: "WIN"),
            game(id: "c", starts: "2026-11-07T20:00:00.000Z", result: "LOSS"),
            game(id: "d", starts: "2026-10-31T18:00:00.000Z", result: "LOSS"),
        ]

        let months = ScoreboardDigest.months(games)

        XCTAssertEqual(months.map(\.id), ["2026-12", "2026-11", "2026-10"])
        XCTAssertEqual(months.map { $0.games.count }, [1, 2, 1])
        XCTAssertEqual(months.first?.games.first?.id, "a")
    }

    func testStreakNeedsTwoGamesAndStopsAtTheFirstDisagreement() {
        let twoWins = [
            game(id: "a", starts: "2026-12-05T18:00:00.000Z", result: "WIN"),
            game(id: "b", starts: "2026-11-28T19:00:00.000Z", result: "WIN"),
            game(id: "c", starts: "2026-11-07T20:00:00.000Z", result: "LOSS"),
        ]
        let streak = ScoreboardDigest.streak(twoWins)
        XCTAssertEqual(streak?.count, 2)
        XCTAssertEqual(streak?.isWin, true)
        XCTAssertEqual(streak?.label, "2 straight wins")

        // A single game is not a streak and must not be announced as one.
        XCTAssertNil(ScoreboardDigest.streak([twoWins[0], twoWins[2]]))
        XCTAssertNil(ScoreboardDigest.streak([]))
    }

    func testFormTakesTheMostRecentGamesOnly() {
        let games = (1...8).map { index in
            game(id: "g\(index)", starts: "2026-11-0\(index)T18:00:00.000Z", result: index.isMultiple(of: 2) ? "WIN" : "LOSS")
        }

        XCTAssertEqual(ScoreboardDigest.form(games).map(\.id), ["g1", "g2", "g3", "g4", "g5"])
        XCTAssertEqual(ScoreboardDigest.form(games, limit: 2).map(\.id), ["g1", "g2"])
    }

    func testHighlightsPreferSustainedSuccessAndSkipUnknownBuckets() throws {
        let scoreboard = try JSONDecoder().decode(UserScoreboard.self, from: Data(highlightJSON.utf8))

        let highlights = scoreboard.highlights

        XCTAssertEqual(highlights.map(\.id), ["sport", "venue", "opponent"])
        XCTAssertEqual(highlights[0].value, "Football")
        XCTAssertEqual(highlights[0].detail, "8 games")
        // A lone 1–0 at the Kohl Center does not outrank a sustained 6–1 at
        // Camp Randall.
        XCTAssertEqual(highlights[1].value, "Camp Randall Stadium")
        XCTAssertEqual(highlights[1].detail, "6–1 · 85.7%")
        // The unknown-opponent bucket is a real row on the table and never a
        // highlight -- "Top matchup: Unknown opponent" says nothing.
        XCTAssertEqual(highlights[2].value, "Purdue")
    }

    func testHighlightsStayEmptyWithoutResolvedGames() throws {
        let scoreboard = try JSONDecoder().decode(UserScoreboard.self, from: Data(emptyJSON.utf8))

        XCTAssertTrue(scoreboard.highlights.isEmpty)
    }

    private func game(id: String, starts: String, result: String) -> ScoreboardEvent {
        let json = """
        {"id":"\(id)","startsAt":"\(starts)","allDay":false,"result":"\(result)",
         "sportCode":"FB","sportLabel":"Football","opponent":"Iowa","site":"HOME",
         "venue":"Camp Randall Stadium","shiftAreas":["VIDEO"]}
        """
        // Force-tried: a malformed literal here is a broken test, not a runtime path.
        return try! JSONDecoder().decode(ScoreboardEvent.self, from: Data(json.utf8))
    }

    private let highlightJSON = """
    {
      "scope": {"key":"2026-27","label":"2026–27 season","startsAt":"2026-07-01T00:00:00.000Z",
                "endsAt":"2027-07-01T00:00:00.000Z","timeZone":"America/Chicago"},
      "summary": {"eventsWorked":38,"wins":14,"losses":12,"games":26,"winRate":53.8},
      "bySport": [
        {"key":"FB","label":"Football","wins":6,"losses":2,"games":8,"winRate":75},
        {"key":"VB","label":"Volleyball","wins":3,"losses":3,"games":6,"winRate":50}
      ],
      "byOpponent": [
        {"key":null,"label":"Unknown opponent","wins":3,"losses":3,"games":6,"winRate":50},
        {"key":"Purdue","label":"Purdue","wins":4,"losses":0,"games":4,"winRate":100}
      ],
      "byVenue": [
        {"key":"Camp Randall Stadium","label":"Camp Randall Stadium","wins":6,"losses":1,"games":7,"winRate":85.7},
        {"key":"Kohl Center","label":"Kohl Center","wins":1,"losses":0,"games":1,"winRate":100}
      ],
      "events": [],
      "nextCursor": null
    }
    """

    private let emptyJSON = """
    {
      "scope": {"key":"2026-27","label":"2026–27 season","startsAt":"2026-07-01T00:00:00.000Z",
                "endsAt":"2027-07-01T00:00:00.000Z","timeZone":"America/Chicago"},
      "summary": {"eventsWorked":4,"wins":0,"losses":0,"games":0,"winRate":null},
      "bySport": [], "byOpponent": [], "bySite": [], "byVenue": [], "events": [], "nextCursor": null
    }
    """

    private let scoreboardJSON = """
    {
      "scope": {
        "key": "2026-27",
        "label": "2026–27 season",
        "startsAt": "2026-07-01T00:00:00.000Z",
        "endsAt": "2027-07-01T00:00:00.000Z",
        "timeZone": "America/Chicago"
      },
      "summary": {
        "eventsWorked": 7,
        "wins": 2,
        "losses": 1,
        "games": 3,
        "winRate": 66.7
      },
      "bySport": [
        {"key":"FB","label":"Football","wins":2,"losses":1,"games":3,"winRate":66.7}
      ],
      "byOpponent": [
        {"key":"Iowa","label":"Iowa","wins":1,"losses":0,"games":1,"winRate":100}
      ],
      "bySite": [
        {"key":"HOME","label":"Home","wins":2,"losses":0,"games":2,"winRate":100}
      ],
      "byVenue": [
        {"key":"Camp Randall Stadium","label":"Camp Randall Stadium","wins":2,"losses":0,"games":2,"winRate":100}
      ],
      "events": [
        {
          "id":"event-1",
          "startsAt":"2026-09-05T18:00:00.000Z",
          "allDay":false,
          "result":"WIN",
          "sportCode":"FB",
          "sportLabel":"Football",
          "opponent":"Iowa",
          "site":"HOME",
          "venue":"Camp Randall Stadium",
          "shiftAreas":["VIDEO","PHOTO"]
        }
      ],
      "nextCursor":"25"
    }
    """
}
