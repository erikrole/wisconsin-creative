#if DEBUG
import SwiftUI

/// One navigable, offline staff shell for reviewing the new iPhone surfaces.
struct LatestBrowseHarnessView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(NetworkMonitor.self) private var network

    var body: some View {
        AppTabView()
            .onAppear {
                session.currentUser = ScheduleFixtures.staffUser
                appState.selectedTab = 2
                appState.pendingBrowseDestination = ProcessInfo.processInfo.environment["GT_BROWSE_DESTINATION"]
            }
            .onChange(of: network.isConnected, initial: true) { _, _ in
                // The shell's connection banner is a captured fixture state too.
                network.isConnected = ProcessInfo.processInfo.environment["GT_BROWSE_OFFLINE"] != "1"
            }
    }
}

/// Fixed representative records for the latest Browse UI; never production data.
enum LatestBrowseFixtureAPI {
    static func calendarEvents(for request: URLRequest) -> Data {
        let data = ScheduleFixtureAPI.calendarEvents(for: request)
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = payload["data"] as? [[String: Any]] else { return data }
        let query = request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
        let includePast = query.first { $0.name == "includePast" }?.value == "true"
        let parser = ISO8601DateFormatter()
        let filtered = rows.filter { row in
            // Omit the launch-relative live row from matched screenshots.
            guard row["id"] as? String != "e9" else { return false }
            guard !includePast else { return true }
            return (row["endsAt"] as? String).flatMap(parser.date(from:)).map { $0 > .now } ?? false
        }.sorted { ($0["startsAt"] as? String ?? "") < ($1["startsAt"] as? String ?? "") }
        let offset = max(0, Int(query.first { $0.name == "offset" }?.value ?? "0") ?? 0)
        let limit = max(1, Int(query.first { $0.name == "limit" }?.value ?? "50") ?? 50)
        let page = Array(filtered.dropFirst(offset).prefix(limit))
        return (try? JSONSerialization.data(withJSONObject: ["data": page, "total": filtered.count])) ?? data
    }

    static func body(path: String) -> Data? {
        switch path {
        case "/api/accountability": return Data(#"""
{
  "generatedAt": "2026-10-16T15:00:00.000Z",
  "truncated": false,
  "scanLimit": 5000,
  "academicYear": {
    "startYear": 2026,
    "label": "2026-27",
    "start": "2026-07-01T05:00:00.000Z",
    "end": "2027-07-01T05:00:00.000Z"
  },
  "methodology": {
    "gracePeriodHours": 2,
    "minimumCheckoutsForRate": 3,
    "sort": "events",
    "ranking": "Late events, then total late time, then most recent incident"
  },
  "metrics": {
    "peopleNeedingAttention": 2,
    "lateEvents": 2,
    "activeOverdue": 1,
    "totalLateHours": 30,
    "excludedRecords": 4
  },
  "capabilities": {
    "canExport": true,
    "canManageExclusions": true
  },
  "locations": [
    {
      "id": "loc_1",
      "name": "Studio"
    }
  ],
  "excluded": [
    {
      "bookingId": "book_hidden",
      "bookingTitle": "Test checkout",
      "requester": "Ada",
      "dueAt": "2026-09-01T15:00:00.000Z",
      "reason": "TEST_DATA",
      "note": null,
      "excludedAt": "2026-09-02T15:00:00.000Z",
      "excludedBy": "Admin"
    }
  ],
  "leaderboard": [
    {
      "userId": "user_ada",
      "name": "Alex Morgan",
      "avatarUrl": null,
      "active": true,
      "primaryArea": "LIVE_PRODUCTION",
      "checkoutCount": 6,
      "completedCount": 5,
      "lateEventCount": 1,
      "activeOverdueCount": 1,
      "totalLateHours": 26,
      "medianLateHours": 26,
      "worstLateHours": 26,
      "onTimeRate": 80,
      "lastIncidentAt": "2026-10-15T18:00:00.000Z",
      "incidents": [
        {
          "incidentId": "book_1:active",
          "bookingId": "book_1",
          "title": "Friday kit",
          "dueAt": "2026-10-14T18:00:00.000Z",
          "returnedAt": null,
          "extendedAt": null,
          "extendedTo": null,
          "lateHours": 26,
          "state": "active",
          "location": {
            "id": "loc_1",
            "name": "Studio"
          },
          "itemSummary": "CAM-1"
        }
      ]
    },
    {
      "userId": "user_grace",
      "name": "Jordan Lee",
      "avatarUrl": "https://example.com/grace.jpg",
      "active": false,
      "primaryArea": null,
      "checkoutCount": 2,
      "completedCount": 2,
      "lateEventCount": 1,
      "activeOverdueCount": 0,
      "totalLateHours": 4,
      "medianLateHours": 4,
      "worstLateHours": 4,
      "onTimeRate": null,
      "lastIncidentAt": "2026-08-01T18:00:00.000Z",
      "incidents": [
        {
          "incidentId": "book_2:extended",
          "bookingId": "book_2",
          "title": "Sunday lens",
          "dueAt": "2026-08-01T15:00:00.000Z",
          "returnedAt": "2026-08-01T20:00:00.000Z",
          "extendedAt": "2026-08-01T16:00:00.000Z",
          "extendedTo": "2026-08-01T18:00:00.000Z",
          "lateHours": 4,
          "state": "extended",
          "location": {
            "id": "loc_1",
            "name": "Studio"
          },
          "itemSummary": ""
        }
      ]
    }
  ]
}
"""#.utf8)
        case "/api/resources/assets": return Data(#"""
{
  "data": {
    "folder": {
      "id": "brand-root",
      "name": "Brand assets",
      "path": "brand-assets"
    },
    "folders": [
      {
        "id": "logos",
        "name": "Logos",
        "path": "brand-assets/logos",
        "assetCount": 18
      },
      {
        "id": "templates",
        "name": "Templates",
        "path": "brand-assets/templates",
        "assetCount": 8
      }
    ],
    "assets": [
      {
        "id": "brand-0",
        "name": "Brand guidelines",
        "kind": "DOCUMENT",
        "description": null,
        "folderId": "brand-root",
        "folder": {
          "id": "brand-root",
          "name": "Brand assets",
          "path": "brand-assets"
        },
        "createdAt": "2026-10-16T18:00:00Z",
        "updatedAt": "2026-10-16T18:00:00Z",
        "versionCount": 2,
        "currentVersion": {
          "id": "ver-0",
          "versionNumber": 2,
          "originalName": "brand-guidelines.pdf",
          "contentType": "application/pdf",
          "sizeBytes": 52000000,
          "versionNote": null,
          "createdAt": "2026-10-16T18:00:00Z",
          "uploadedBy": {
            "id": "fixture-staff",
            "name": "Creative team"
          }
        }
      },
      {
        "id": "brand-1",
        "name": "Primary logos",
        "kind": "LOGO",
        "description": null,
        "folderId": "brand-root",
        "folder": {
          "id": "brand-root",
          "name": "Brand assets",
          "path": "brand-assets"
        },
        "createdAt": "2026-10-16T18:00:00Z",
        "updatedAt": "2026-10-16T18:00:00Z",
        "versionCount": 2,
        "currentVersion": {
          "id": "ver-1",
          "versionNumber": 2,
          "originalName": "primary-logos.svg",
          "contentType": "image/svg+xml",
          "sizeBytes": 2200,
          "versionNote": null,
          "createdAt": "2026-10-16T18:00:00Z",
          "uploadedBy": {
            "id": "fixture-staff",
            "name": "Creative team"
          }
        }
      },
      {
        "id": "brand-2",
        "name": "Gotham font family",
        "kind": "FONT",
        "description": null,
        "folderId": "brand-root",
        "folder": {
          "id": "brand-root",
          "name": "Brand assets",
          "path": "brand-assets"
        },
        "createdAt": "2026-10-16T18:00:00Z",
        "updatedAt": "2026-10-16T18:00:00Z",
        "versionCount": 2,
        "currentVersion": {
          "id": "ver-2",
          "versionNumber": 2,
          "originalName": "Gotham.ttf",
          "contentType": "font/ttf",
          "sizeBytes": 660000,
          "versionNote": null,
          "createdAt": "2026-10-16T18:00:00Z",
          "uploadedBy": {
            "id": "fixture-staff",
            "name": "Creative team"
          }
        }
      }
    ]
  }
}
"""#.utf8)
        case "/api/gear-picks/me": return Data(#"""
{
  "data": {
    "cycle": {
      "id": "cycle-2026",
      "title": "2026 Staff Gear",
      "deadline": "2026-11-01T23:00:00Z",
      "isOpen": true,
      "launchedAt": "2026-10-01T12:00:00Z"
    },
    "participant": {
      "id": "participant-staff",
      "fit": "MEN",
      "allowanceCents": 30000
    },
    "submission": null,
    "catalog": {
      "maxQuantity": 5,
      "categories": [
        "Tops",
        "Footwear",
        "Headwear"
      ],
      "items": [
        {
          "style": "STYLE0",
          "name": "Wisconsin Performance Polo",
          "fit": "MEN",
          "category": "Tops",
          "priceCents": 5500,
          "sizeLabel": "Size",
          "sizes": [
            "S",
            "M",
            "L",
            "XL",
            "XXL"
          ],
          "sizesAreExact": false,
          "oneSize": false,
          "defaultSize": null,
          "kit": null,
          "colors": [
            {
              "code": "RED",
              "label": "Wisconsin Red",
              "swatch": "#C5050C",
              "image": ""
            },
            {
              "code": "BLK",
              "label": "Black",
              "swatch": "#222222",
              "image": ""
            }
          ]
        },
        {
          "style": "STYLE1",
          "name": "Wisconsin Training Hoodie",
          "fit": "MEN",
          "category": "Tops",
          "priceCents": 6800,
          "sizeLabel": "Size",
          "sizes": [
            "S",
            "M",
            "L",
            "XL"
          ],
          "sizesAreExact": false,
          "oneSize": false,
          "defaultSize": null,
          "kit": null,
          "colors": [
            {
              "code": "RED",
              "label": "Wisconsin Red",
              "swatch": "#C5050C",
              "image": ""
            },
            {
              "code": "BLK",
              "label": "Black",
              "swatch": "#222222",
              "image": ""
            }
          ]
        },
        {
          "style": "STYLE2",
          "name": "Charged Assert Running Shoes",
          "fit": "MEN",
          "category": "Footwear",
          "priceCents": 7500,
          "sizeLabel": "Size",
          "sizes": [
            "8",
            "9",
            "10",
            "11",
            "12"
          ],
          "sizesAreExact": true,
          "oneSize": false,
          "defaultSize": null,
          "kit": null,
          "colors": [
            {
              "code": "RED",
              "label": "Wisconsin Red",
              "swatch": "#C5050C",
              "image": ""
            },
            {
              "code": "BLK",
              "label": "Black",
              "swatch": "#222222",
              "image": ""
            }
          ]
        },
        {
          "style": "STYLE3",
          "name": "Wisconsin Adjustable Cap",
          "fit": "MEN",
          "category": "Headwear",
          "priceCents": 2800,
          "sizeLabel": "Size",
          "sizes": [
            "OSFA"
          ],
          "sizesAreExact": true,
          "oneSize": true,
          "defaultSize": null,
          "kit": null,
          "colors": [
            {
              "code": "RED",
              "label": "Wisconsin Red",
              "swatch": "#C5050C",
              "image": ""
            },
            {
              "code": "BLK",
              "label": "Black",
              "swatch": "#222222",
              "image": ""
            }
          ]
        }
      ]
    }
  }
}
"""#.utf8)
        case "/api/kits": return Data(#"""
{
  "data": [
    {
      "id": "kit-0",
      "name": "Football sideline",
      "description": null,
      "sportCode": "FB",
      "gamedayRole": null,
      "active": true,
      "location": {
        "id": "loc-1",
        "name": "Camp Randall"
      },
      "_count": {"members": 6, "bulkMembers": 2},
      "availability": {
        "serialized": 6,
        "unavailable": 0
      }
    },
    {
      "id": "kit-1",
      "name": "Basketball photo",
      "description": null,
      "sportCode": null,
      "gamedayRole": null,
      "active": true,
      "location": {
        "id": "loc-1",
        "name": "Camp Randall"
      },
      "_count": {"members": 5, "bulkMembers": 2},
      "availability": {
        "serialized": 5,
        "unavailable": 2
      }
    },
    {
      "id": "kit-2",
      "name": "Social video",
      "description": null,
      "sportCode": null,
      "gamedayRole": null,
      "active": true,
      "location": {
        "id": "loc-1",
        "name": "Camp Randall"
      },
      "_count": {"members": 4, "bulkMembers": 2},
      "availability": {
        "serialized": 4,
        "unavailable": 4
      }
    },
    {
      "id": "kit-3",
      "name": "Interview audio",
      "description": null,
      "sportCode": null,
      "gamedayRole": null,
      "active": true,
      "location": {
        "id": "loc-1",
        "name": "Camp Randall"
      },
      "_count": {"members": 3, "bulkMembers": 2},
      "availability": {
        "serialized": 3,
        "unavailable": 0
      }
    }
  ],
  "total": 4,
  "limit": 50,
  "offset": 0,
  "summary": {
    "total": 4,
    "active": 4,
    "archived": 0,
    "empty": 0
  }
}
"""#.utf8)
        case "/api/bulk-skus/batteries": return Data(#"""
{
  "data": {
    "totals": {
      "total": 42,
      "available": 24,
      "checkedOut": 14,
      "lost": 2,
      "retired": 2,
      "lowSkus": 1
    },
    "skus": [
      {
        "id": "bat-1",
        "name": "Sony NP-FZ100",
        "category": "Batteries",
        "trackByNumber": true,
        "location": {"id": "fixture-location", "name": "Camp Randall"},
        "counts": {
          "available": 18,
          "checkedOut": 8,
          "lost": 0,
          "retired": 0
        },
        "isLow": false,
        "labelPrintedCount": 26,
        "labelNeededCount": 0,
        "units": []
      },
      {
        "id": "bat-2",
        "name": "Canon LP-E6NH",
        "category": "Batteries",
        "trackByNumber": true,
        "location": {"id": "fixture-location", "name": "Kohl Center"},
        "counts": {
          "available": 6,
          "checkedOut": 6,
          "lost": 2,
          "retired": 2
        },
        "isLow": true,
        "labelPrintedCount": 16,
        "labelNeededCount": 0,
        "units": []
      }
    ],
    "compatibility": [],
    "integrity": {
      "staleCheckedOutCount": 0
    }
  }
}
"""#.utf8)
        case "/api/badges": return Data(#"""
{
  "data": [
    {
      "id": "badge-0",
      "key": "manual-0",
      "name": "Above and Beyond",
      "description": "Recognizes the extra effort that makes a production better.",
      "icon": "star.fill",
      "category": "TEAMWORK",
      "kind": "MANUAL",
      "trigger": "MANUAL",
      "threshold": null,
      "ruleKey": null,
      "active": true,
      "sortOrder": 0
    },
    {
      "id": "badge-1",
      "key": "manual-1",
      "name": "Creative Spark",
      "description": "A fresh idea that made it into the final story.",
      "icon": "sparkles",
      "category": "CREATIVITY",
      "kind": "MANUAL",
      "trigger": "MANUAL",
      "threshold": null,
      "ruleKey": null,
      "active": true,
      "sortOrder": 1
    },
    {
      "id": "badge-2",
      "key": "manual-2",
      "name": "Ready for Gameday",
      "description": "Consistent preparation, clear communication, and dependable execution.",
      "icon": "checkmark.seal.fill",
      "category": "RELIABILITY",
      "kind": "MANUAL",
      "trigger": "MANUAL",
      "threshold": null,
      "ruleKey": null,
      "active": true,
      "sortOrder": 2
    }
  ],
  "disabled": false
}
"""#.utf8)
        case "/api/me/blasts": return Data(#"""
{
  "data": [
    {
      "id": "latest-blast-0",
      "title": "Saturday production briefing",
      "body": "Crew check-in opens at 9:30 a.m. Review your assignment in Schedule before heading to the venue.",
      "severity": "INFO",
      "sentAt": "2026-10-17T15:00:00Z",
      "senderName": "Creative team",
      "requiresAck": true,
      "readAt": null
    },
    {
      "id": "latest-blast-1",
      "title": "Return batteries to the charging shelf",
      "body": "Please return numbered batteries to the correct charging bay after your shoot.",
      "severity": "WARNING",
      "sentAt": "2026-10-17T15:00:00Z",
      "senderName": "Creative team",
      "requiresAck": true,
      "readAt": null
    }
  ]
}
"""#.utf8)
        case "/api/reports/usage": return Data(#"""
{
  "days": 30,
  "totalEvents": 12,
  "activeUsers": 3,
  "platforms": [
    {
      "name": "ios",
      "count": 9
    },
    {
      "name": "web",
      "count": 3
    }
  ],
  "surfaces": [
    {
      "name": "bookings",
      "count": 5
    }
  ],
  "events": [],
  "versions": [
    {
      "platform": "ios",
      "version": "1.3",
      "count": 9
    }
  ],
  "notifications": {
    "deliveries": [
      {
        "name": "push \u00b7 sent",
        "count": 4
      }
    ],
    "pushReadiness": [],
    "preferenceChanges": [],
    "responses": [],
    "timeToAct": []
  },
  "health": {
    "jobs": [],
    "diagnostics": []
  }
}
"""#.utf8)
        case "/api/reports/scans": return Data(#"""
{
  "data": [
    {
      "id": "s1",
      "actor": "Ada",
      "success": true,
      "phase": "CHECKOUT",
      "item": "CAM-1",
      "bookingId": "b1",
      "bookingTitle": "Friday",
      "createdAt": "2026-07-11T14:00:00.000Z",
      "scanValue": "secret"
    }
  ],
  "total": 2,
  "previousTotal": 1,
  "previousSuccessRate": 50,
  "successCount": 1,
  "successRate": 100,
  "dailyScans": [
    {
      "date": "2026-07-11",
      "success": 1,
      "fail": 0
    }
  ],
  "limit": 1,
  "offset": 0
}
"""#.utf8)
        case "/api/reports/missing-units": return Data(#"""
{
  "totalLost": 2,
  "categoryId": null,
  "locationId": null,
  "filterOptions": {
    "categories": [
      {
        "id": "c1",
        "name": "Batteries"
      }
    ],
    "locations": [
      {
        "id": "l1",
        "name": "Studio"
      }
    ]
  },
  "bySku": [
    {
      "skuName": "Sony Battery",
      "bulkSkuId": "sku1",
      "count": 2
    }
  ],
  "byUser": [
    {
      "name": "Ada",
      "count": 2
    }
  ],
  "recentLosses": [
    {
      "id": "e1",
      "bookingId": "b1",
      "lostUnits": {
        "ignored": true
      },
      "createdAt": "2026-07-11T14:00:00.000Z",
      "actor": {
        "id": "u1",
        "name": "Ada",
        "avatarUrl": null
      }
    }
  ],
  "batteryAudit": {
    "totals": {
      "skuCount": 1,
      "totalUnits": 4,
      "available": 1,
      "checkedOut": 1,
      "lost": 2,
      "retired": 0,
      "lossRate": 0.5,
      "repeatPatternCount": 1
    },
    "bySku": [
      {
        "bulkSkuId": "sku1",
        "skuName": "Sony Battery",
        "category": "Batteries",
        "location": "Studio",
        "total": 4,
        "available": 1,
        "checkedOut": 1,
        "lost": 2,
        "retired": 0,
        "lossRate": 0.5,
        "missingUnitNumbers": [
          7,
          8
        ],
        "lastMissingAt": null
      }
    ],
    "missingUnits": [
      {
        "id": "unit7",
        "bulkSkuId": "sku1",
        "skuName": "Sony Battery",
        "unitNumber": 7,
        "notes": null,
        "markedMissingAt": "2026-07-11T14:00:00.000Z",
        "lastCheckoutAt": null,
        "lastRequesterId": "u1",
        "lastRequesterName": "Ada",
        "lastBookingId": "b1",
        "lastBookingRef": "CO-1",
        "lastBookingTitle": "Friday"
      }
    ],
    "checkoutHistory": [],
    "repeatPatterns": [
      {
        "type": "sku",
        "label": "Sony Battery",
        "count": 2,
        "detail": "2 missing units"
      }
    ]
  }
}
"""#.utf8)
        case "/api/reports/badges": return Data(#"""
{
  "totalAwards": 4,
  "manualAwards": 1,
  "automaticAwards": 3,
  "manualAwardRate": 0.25,
  "days": 30,
  "recentAwardCount": 2,
  "previousRecentAwardCount": 1,
  "activeDefinitionCount": 6,
  "leaderboard": [
    {
      "userId": "u1",
      "name": "Ada",
      "email": "ada@example.com",
      "count": 3
    }
  ],
  "distribution": [
    {
      "definitionId": "d1",
      "key": "on_time",
      "name": "On time",
      "category": "ON_TIME",
      "active": true,
      "count": 3
    }
  ],
  "recentAwards": [
    {
      "id": "a1",
      "awardedAt": "2026-07-11T14:00:00.000Z",
      "source": "MANUAL",
      "note": "Nice catch",
      "user": {
        "id": "u1",
        "name": "Ada",
        "email": "ada@example.com"
      },
      "definition": {
        "id": "d1",
        "key": "on_time",
        "name": "On time",
        "category": "ON_TIME",
        "icon": "star",
        "active": true
      },
      "awardedBy": {
        "id": "u2",
        "name": "Bea"
      }
    }
  ],
  "underusedDefinitions": [
    {
      "definitionId": "d2",
      "key": "rare",
      "name": "Rare",
      "category": "MILESTONE",
      "count": 0
    }
  ]
}
"""#.utf8)
        default: return nil
        }
    }
}
#endif
