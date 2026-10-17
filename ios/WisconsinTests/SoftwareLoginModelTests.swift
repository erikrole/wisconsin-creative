import Testing
import Foundation
@testable import Wisconsin

@Suite
struct SoftwareLoginModelTests {
    @Test
    func audiencePhraseMatchesTheWebsite() {
        #expect(SoftwareLoginFormatting.audiencePhrase([]) == "no audience")
        #expect(SoftwareLoginFormatting.audiencePhrase(["STAFF"]) == "Staff")
        #expect(SoftwareLoginFormatting.audiencePhrase(["STAFF", "STUDENT"]) == "Staff and Students")
        #expect(
            SoftwareLoginFormatting.audiencePhrase(["STAFF", "STUDENT", "COLLABORATOR"])
                == "Staff, Students, and Collaborators"
        )
        #expect(SoftwareLoginFormatting.audiencePhrase(["VENDOR"]) == "VENDOR")
    }

    @Test
    func websiteLinkAllowsOnlyWebAddresses() {
        #expect(SoftwareLoginFormatting.websiteURL("https://elements.envato.com/sign-in")?.host == "elements.envato.com")
        #expect(SoftwareLoginFormatting.websiteURL(" http://example.com ")?.scheme == "http")
        #expect(SoftwareLoginFormatting.websiteURL("javascript:alert(1)") == nil)
        #expect(SoftwareLoginFormatting.websiteURL("file:///tmp/secret") == nil)
        #expect(SoftwareLoginFormatting.websiteURL("https://") == nil)
        #expect(SoftwareLoginFormatting.websiteURL(nil) == nil)
        #expect(SoftwareLoginFormatting.websiteURL("  ") == nil)
    }

    @Test
    func archivedAndBlankRowsStayOutOfTheActiveList() {
        #expect(sample(archivedAt: nil).isActive)
        #expect(sample(archivedAt: "  ").isActive)
        #expect(!sample(archivedAt: "2026-08-01T00:00:00.000Z").isActive)
        #expect(sample(category: nil).categoryLabel == "Department account")
        #expect(sample(category: " Music ").categoryLabel == "Music")
    }

    @Test
    func searchUsesNameEmailAudienceAndHost() {
        let login = sample(
            name: "Envato Elements",
            category: "Stock",
            websiteUrl: "https://elements.envato.com",
            accountEmail: "creative@athletics.wisc.edu",
            visibleTo: ["STAFF", "STUDENT"]
        )
        #expect(login.matches(query: " envato "))
        #expect(login.matches(query: "creative@"))
        #expect(login.matches(query: "students"))
        #expect(login.matches(query: "elements.envato.com"))
        #expect(!login.matches(query: "motion array"))
        #expect(login.matches(query: "   "))
    }

    private func sample(
        name: String = "APM Music",
        category: String? = "Audio",
        websiteUrl: String? = nil,
        accountEmail: String = "desk@example.com",
        visibleTo: [String] = ["STAFF"],
        archivedAt: String? = nil
    ) -> SoftwareLogin {
        SoftwareLogin(
            id: "login",
            name: name,
            category: category,
            websiteUrl: websiteUrl,
            accountEmail: accountEmail,
            visibleTo: visibleTo,
            archivedAt: archivedAt
        )
    }
}
