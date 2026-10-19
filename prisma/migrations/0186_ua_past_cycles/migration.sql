-- UA gear history: past years kept read-only, separate from the live pick cycle.
CREATE TABLE "gear_past_cycles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "budget_cents" INTEGER NOT NULL,
    "budgeted_spend_cents" INTEGER NOT NULL,
    "other_spend_cents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_past_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gear_past_items" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "color_label" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "planned_qty" INTEGER NOT NULL,
    "ordered_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gear_past_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gear_past_people" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_label" TEXT NOT NULL,
    "fit" TEXT NOT NULL,
    "top_size" TEXT,
    "shoe_size" TEXT,

    CONSTRAINT "gear_past_people_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gear_past_items_cycle_id_idx" ON "gear_past_items"("cycle_id");
CREATE INDEX "gear_past_people_cycle_id_idx" ON "gear_past_people"("cycle_id");

ALTER TABLE "gear_past_items" ADD CONSTRAINT "gear_past_items_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_past_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gear_past_people" ADD CONSTRAINT "gear_past_people_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_past_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2026-27, copied from the Equipment department's Google Sheet (Dashboard, Reconciliation, Order Plan, Roster).
INSERT INTO "gear_past_cycles" ("id", "title", "budget_cents", "budgeted_spend_cents", "other_spend_cents", "note")
VALUES ('2026-27', '2026–27 Under Armour gear', 550000, 583100, 46250, 'Copied from the 2026–27 sheet while handout was under way. Prices are as listed on its Order Plan; the sheet leaves two women''s student items unpriced.');

INSERT INTO "gear_past_items" ("id", "cycle_id", "sku", "item_name", "color_label", "unit_price_cents", "planned_qty", "ordered_qty", "received_qty") VALUES
('past-2026-27-item-1384641-001', '2026-27', '1384641-001', 'LIMITLESS DOWN JACKET', 'BLACK / BLACK', 14000, 6, 0, 0),
('past-2026-27-item-6006030-101', '2026-27', '6006030-101', 'UA VELOCITI DISTANCE SHOES', 'BLACK / WHITE', 8400, 15, 0, 0),
('past-2026-27-item-6013172-016', '2026-27', '6013172-016', 'M STORM FLEECE PRO CREW PIN', 'MOD GRAY LIGHT HEATHER / FLAWLESS', 3750, 7, 0, 0),
('past-2026-27-item-6013183-107', '2026-27', '6013183-107', 'W STORM FLEECE PRO CREW PIN', 'WHITE / FLAWLESS', 3750, 1, 0, 0),
('past-2026-27-item-6013185-006', '2026-27', '6013185-006', 'W STORM FLEECE PRO JOGGER PIN', 'BLACK / FLAWLESS', 4000, 2, 0, 0),
('past-2026-27-item-6013193-835', '2026-27', '6013193-835', 'W VANISH SLEEVELESS PIN', 'FLAWLESS / WHITE', 2000, 1, 0, 0),
('past-2026-27-item-6013197-006', '2026-27', '6013197-006', 'W PLAY UP SHORT PIN', 'BLACK / FLAWLESS', 2000, 2, 0, 0),
('past-2026-27-item-6013197-834', '2026-27', '6013197-834', 'W PLAY UP SHORT PIN', 'FLAWLESS / WHITE', 2000, 1, 0, 0),
('past-2026-27-item-6013198-006', '2026-27', '6013198-006', 'W FLY BY SHORT PIN', 'BLACK / FLAWLESS', 1750, 1, 0, 0),
('past-2026-27-item-6013198-834', '2026-27', '6013198-834', 'W FLY BY SHORT PIN', 'FLAWLESS / WHITE', 1750, 1, 0, 0),
('past-2026-27-item-6013216-107', '2026-27', '6013216-107', 'M PLAYOFF BLADED TOP PIN', 'WHITE / FLAWLESS', 3750, 2, 0, 0),
('past-2026-27-item-6013217-834', '2026-27', '6013217-834', 'M PLAYOFF CHEST STRIPE POLO PIN', 'FLAWLESS / WHITE', 3750, 25, 0, 0),
('past-2026-27-item-6013230-003', '2026-27', '6013230-003', 'W PLAYOFF MIDWT 1/4 ZIP PIN', 'BLACK / FLAWLESS', 0, 5, 5, 5),
('past-2026-27-item-6013256-006', '2026-27', '6013256-006', 'W UNSTOPPABLE FLEECE FULL-ZIP PIN', 'BLACK / FLAWLESS', 6500, 1, 1, 1),
('past-2026-27-item-6013329-006', '2026-27', '6013329-006', 'M ATHLETICS SS TEE PIN', 'BLACK / FLAWLESS', 1250, 25, 10, 10),
('past-2026-27-item-6013330-834', '2026-27', '6013330-834', 'M ATHLETICS LS TEE PIN', 'FLAWLESS / WHITE', 1500, 10, 0, 0),
('past-2026-27-item-6013334-006', '2026-27', '6013334-006', 'W ATHLETICS SS TEE PIN', 'BLACK / FLAWLESS', 0, 4, 4, 4),
('past-2026-27-item-6013338-006', '2026-27', '6013338-006', 'W ICON FLEECE HALF-ZIP HOODIE PIN', 'BLACK / FLAWLESS', 4500, 1, 0, 0),
('past-2026-27-item-6013339-006', '2026-27', '6013339-006', 'W ICON FLEECE WIDE-LEG PANT PIN', 'BLACK / FLAWLESS', 4500, 1, 0, 0),
('past-2026-27-item-6013341-107', '2026-27', '6013341-107', 'M SPORTSWEAR TEE PIN', 'WHITE / FLAWLESS', 2250, 3, 0, 0),
('past-2026-27-item-6013345-107', '2026-27', '6013345-107', 'W SPORTSWEAR TEE PIN', 'WHITE / FLAWLESS', 2250, 1, 0, 0),
('past-2026-27-item-6013349-006', '2026-27', '6013349-006', 'M MERIDIAN SS TEE PIN', 'BLACK / FLAWLESS', 3250, 7, 0, 0),
('past-2026-27-item-6013350-107', '2026-27', '6013350-107', 'M MERIDIAN 1/4 ZIP PIN', 'WHITE / FLAWLESS', 4250, 7, 0, 0),
('past-2026-27-item-6013357-834', '2026-27', '6013357-834', 'M MERIDIAN CW 1/4 ZIP PIN', 'FLAWLESS / WHITE', 5000, 25, 10, 10),
('past-2026-27-item-6015024-001', '2026-27', '6015024-001', 'W MERIDIAN LEGGING PIN', 'BLACK / BLACK', 5250, 1, 0, 0),
('past-2026-27-item-6017181-100', '2026-27', '6017181-100', 'BLITZING A-FRAME ADJ', 'WHITE', 0, 3, 3, 3),
('past-2026-27-item-6017187-203', '2026-27', '6017187-203', 'KNIT BEANIE', 'BEIGE', 2300, 7, 0, 0),
('past-2026-27-item-6017190-001', '2026-27', '6017190-001', 'UNDENIABLE MD DUFFLE', 'BLACK', 0, 3, 3, 3),
('past-2026-27-item-6017191-100', '2026-27', '6017191-100', 'POM BEANIE', 'GRAY', 2300, 5, 0, 0);

INSERT INTO "gear_past_people" ("id", "cycle_id", "name", "group_label", "fit", "top_size", "shoe_size") VALUES
('past-2026-27-person-1', '2026-27', 'Jerry Mao', 'Full-Time Staff', 'Men', 'S', '8'),
('past-2026-27-person-2', '2026-27', 'Ryan Dean', 'Full-Time Staff', 'Men', 'XL', '11'),
('past-2026-27-person-3', '2026-27', 'Erik Role', 'Full-Time Staff', 'Men', 'M', '11'),
('past-2026-27-person-4', '2026-27', 'Cole Ahlgren', 'Full-Time Staff', 'Men', 'M', '9.5'),
('past-2026-27-person-5', '2026-27', 'Usman Syed', 'Full-Time Staff', 'Men', 'S', '9'),
('past-2026-27-person-6', '2026-27', 'Nolan Kromke', 'Full-Time Staff', 'Men', 'L', '10.5'),
('past-2026-27-person-7', '2026-27', 'Ben Snyder', 'Full-Time Staff', 'Men', 'S', '11'),
('past-2026-27-person-8', '2026-27', 'Maddy Pehler', 'Full-Time Staff', 'Women', 'M', '8.5'),
('past-2026-27-person-9', '2026-27', 'Emma Hansen', 'Full-Time Staff', 'Women', 'M', '8.5'),
('past-2026-27-person-10', '2026-27', 'Laurie Digman', 'Full-Time Staff', 'Women', 'L', '11'),
('past-2026-27-person-11', '2026-27', 'David Saddler', 'Student', 'Men', 'S', '9'),
('past-2026-27-person-12', '2026-27', 'William Clarke', 'Student', 'Men', 'XXL', '13'),
('past-2026-27-person-13', '2026-27', 'Benjamin Xiong', 'Student', 'Men', 'S', '8.5'),
('past-2026-27-person-14', '2026-27', 'Owen Phillips', 'Student', 'Men', 'M', '10'),
('past-2026-27-person-15', '2026-27', 'Mason Howard', 'Student', 'Men', 'M', '9'),
('past-2026-27-person-16', '2026-27', 'Connor Oamek', 'Student', 'Men', 'L', '10.5'),
('past-2026-27-person-17', '2026-27', 'Mateo Reynolds', 'Student', 'Men', 'M', '9'),
('past-2026-27-person-18', '2026-27', 'Billy Powell', 'Student', 'Men', 'L', '12'),
('past-2026-27-person-19', '2026-27', 'Miles Felix', 'Student', 'Men', 'M', '9.5'),
('past-2026-27-person-20', '2026-27', 'Zach Lowery', 'Student', 'Men', NULL, NULL),
('past-2026-27-person-21', '2026-27', 'Johnathan Dye', 'Student', 'Men', NULL, NULL),
('past-2026-27-person-22', '2026-27', 'Amina Haniieva', 'Student', 'Women', NULL, NULL),
('past-2026-27-person-23', '2026-27', 'Maddy Nissenbaum', 'Student', 'Women', 'S', '6.5'),
('past-2026-27-person-24', '2026-27', 'Abigail Peterson', 'Student', 'Women', 'S', '8');
