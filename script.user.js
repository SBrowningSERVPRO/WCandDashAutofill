// ==UserScript==
// @name         WorkCenter + CreateJob Intake Autofill
// @namespace    http://tampermonkey.net/
// @version      23.05
// @description  Combined autofill with load-on-demand RadComboBox support, Division checkboxes, Insurance Carrier, Claim/Policy, Loss Description, robust address/name/phone/date parsing
// @updateURL    https://github.com/SBrowningSERVPRO/WCandDashAutofill/raw/main/script.user.js
// @downloadURL  https://github.com/SBrowningSERVPRO/WCandDashAutofill/raw/main/script.user.js
// @match        https://workcenter-sp.servpronet.io/intake*
// @match        https://servpro.ngsapps.net/Enterprise/Module/Job/CreateJob.aspx*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = "23.05";   // keep in sync with @version above - shown in the panel header

    // ==========================================
    //  FIXED COLUMN INDICES (shared data key format)
    // ==========================================
    const COLUMN = {
        Id: 0,
        StartTime: 1,
        CompletionTime: 2,
        Email: 3,
        Name: 4,
        Initials: 5,
        CallerName: 6,                          // POC Name
        PropertyType: 7,                        // Residential or Commercial
        BusinessName: 8,                        // Commercial Business Name
        ReportedBy: 9,                          // POC's Affiliation
        LossAddress: 10,
        BillingAddress: 11,
        AdditionalPhone: 12,
        Phone: 13,                              // Phone Number
        SecondaryEmail: 14,
        Email_Field: 15,                        // Email Address
        TypeOfLoss: 16,
        DateOfLoss: 17,
        CauseOfLoss: 18,                        // Cause of Loss/Has it been resolved
        AffectedAreas: 19,
        AdditionalDetails: 20,
        YearBuilt: 21,
        ReferredBy: 22,                          // How did you hear about Servpro?
        ConcreteOrCrawl: 23,
        SelfPayOrIns: 24,
        InsuranceCarrier: 25,
        ClaimNum: 26,
        PolicyNum: 27,
        InsuranceAgentAdjuster: 28,
        ServproHQRef: 29,
        MarketingRep: 30,
        EnvironmentalCode: 31,
        IsEmergency: 32,
        ScheduledPM: 33,                        // Scheduled PM Name
        ArrivalDate: 34,
        ArrivalTime: 35,                        // Arrival Time Window
        PerCustomerRequest: 36,
        Confirmed: 37,
        SpecialInstructions: 38,
        DepositRequired: 39,
        ScheduledPMFor: 40,
        DepositPaymentMethod: 41,
        GeneratedFNOL: 42,
        Notes: 43
    };

async function fetchEstimatorBatch(text) {
    const res = await fetch("https://servpro.ngsapps.net/Enterprise/Module/SearchAssist/ProductService.asmx/GetProviderEmployee", {
        headers: {
            "accept": "*/*",
            "content-type": "application/json; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        },
        referrer: location.href,
        body: JSON.stringify({ context: { Text: text, NumberOfItems: 0 } }),
        method: "POST",
        mode: "cors",
        credentials: "include"
    });
    const json = await res.json();
    let payload = json.d;
    if (typeof payload === "string") payload = JSON.parse(payload);
    return (payload && payload.Items) || [];
}

    async function fetchCompanyCustomerBatch(text) {
    try {
        const res = await fetch("https://servpro.ngsapps.net/Enterprise/Module/Services/DropDownsService.asmx/GetCompanyCustomerMultiColumn", {
            headers: { "accept": "*/*", "content-type": "application/json; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
            referrer: location.href,
            body: JSON.stringify({ context: { Text: text, NumberOfItems: 0 } }),
            method: "POST", mode: "cors", credentials: "include"
        });
        const json = await res.json();
        let payload = json.d;
        if (typeof payload === "string") payload = JSON.parse(payload);
        return (payload && payload.Items) || [];
    } catch (e) {
        console.log("fetchCompanyCustomerBatch error:", e.message);
        return [];
    }
}

async function findCompanyCustomerByAddress(parsedAddr) {
    let street = (parsedAddr.street || "").toLowerCase().trim();
    let zip = (parsedAddr.zip || "").trim();
    if (!street) return null;
    let items = await fetchCompanyCustomerBatch(parsedAddr.street);
    if (!items.length) return null;
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street) && (!zip || addr.includes(zip))) return item;
    }
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street)) return item;
    }
    return null;
}

async function findEstimatorMatch(scheduledPMRaw) {
    if (!scheduledPMRaw || scheduledPMRaw === "**NOT ASSIGNED**") return null;
    let raw = scheduledPMRaw.trim();
    if (!raw) return null;

    // Accepts "First Last", "First M. Last", "Last, First"
    let name = splitName(raw);
    let lastName = name.last || name.first;
    let firstName = name.last ? name.first : "";

    let lastLower = lastName.toLowerCase();
    let firstLower = firstName.toLowerCase();

    // Try last name, then first name, then the whole raw string
    let candidates = [lastName, firstName, raw].filter(Boolean);

    for (let candidate of candidates) {
        let items = await fetchEstimatorBatch(candidate);
        if (!items.length) continue;

        // Strict: "Last, First..." where Last matches exactly and First starts with our first name
        for (let item of items) {
            let [itemLast, itemFirst] = item.Text.toLowerCase().split(",").map(s => (s || "").trim());
            if (itemLast === lastLower && itemFirst && firstLower && itemFirst.startsWith(firstLower)) {
                return item;
            }
        }
        // Looser: text contains both name parts somewhere
        if (firstLower) {
            for (let item of items) {
                let t = item.Text.toLowerCase();
                if (t.includes(lastLower) && t.includes(firstLower)) return item;
            }
        }
        // Single-word name (or no first-name hit): accept an unambiguous last-name match
        let lastOnly = items.filter(item => (item.Text.toLowerCase().split(",")[0] || "").trim() === lastLower);
        if (lastOnly.length === 1) return lastOnly[0];
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

    // --- Zip to Franchise Mapping (raw WC FranchiseDD values) ---
    const zipToFranchiseMap = {"23002": "Chesterfield (C) 5248", "23112": "Chesterfield (C) 5248", "23113": "Chesterfield (C) 5248", "23114": "Chesterfield (C) 5248", "23120": "Chesterfield (C) 5248", "23139": "Chesterfield (C) 5248", "23234": "Chesterfield (C) 5248", "23235": "Chesterfield (C) 5248", "23236": "Chesterfield (C) 5248", "23237": "Chesterfield (C) 5248", "23831": "Chesterfield (C) 5248", "23832": "Chesterfield (C) 5248", "23836": "Chesterfield (C) 5248", "23838": "Chesterfield (C) 5248", "Chesterfield (PSP Franchise # 750273)": "Chesterfield (C) 5248", "23173": "Richmond (R) 10313", "23218": "Richmond (R) 10313", "23219": "Richmond (R) 10313", "23220": "Richmond (R) 10313", "23221": "Richmond (R) 10313", "23222": "Richmond (R) 10313", "23223": "Richmond (R) 10313", "23224": "Richmond (R) 10313", "23225": "Richmond (R) 10313", "23232": "Richmond (R) 10313", "23240": "Richmond (R) 10313", "23241": "Richmond (R) 10313", "23249": "Richmond (R) 10313", "23260": "Richmond (R) 10313", "23261": "Richmond (R) 10313", "23284": "Richmond (R) 10313", "23285": "Richmond (R) 10313", "23298": "Richmond (R) 10313", "23058": "Henrico (H) 10314", "23059": "Henrico (H) 10314", "23060": "Henrico (H) 10314", "23075": "Henrico (H) 10314", "23111": "Henrico (H) 10314", "23150": "Henrico (H) 10314", "23226": "Henrico (H) 10314", "23227": "Henrico (H) 10314", "23228": "Henrico (H) 10314", "23229": "Henrico (H) 10314", "23230": "Henrico (H) 10314", "23231": "Henrico (H) 10314", "23233": "Henrico (H) 10314", "23238": "Henrico (H) 10314", "23242": "Henrico (H) 10314", "23250": "Henrico (H) 10314", "23255": "Henrico (H) 10314", "23294": "Henrico (H) 10314", "23801": "Tri-Cities (T) 8510", "23803": "Tri-Cities (T) 8510", "23804": "Tri-Cities (T) 8510", "23805": "Tri-Cities (T) 8510", "23806": "Tri-Cities (T) 8510", "23825": "Tri-Cities (T) 8510", "23830": "Tri-Cities (T) 8510", "23833": "Tri-Cities (T) 8510", "23834": "Tri-Cities (T) 8510", "23840": "Tri-Cities (T) 8510", "23841": "Tri-Cities (T) 8510", "23842": "Tri-Cities (T) 8510", "23850": "Tri-Cities (T) 8510", "23860": "Tri-Cities (T) 8510", "23872": "Tri-Cities (T) 8510", "23875": "Tri-Cities (T) 8510", "23882": "Tri-Cities (T) 8510", "23885": "Tri-Cities (T) 8510", "23894": "Tri-Cities (T) 8510", "23321": "Chesapeake N (CN) 11281", "23322": "Chesapeake N (CN) 11281", "23323": "Chesapeake N (CN) 11281", "23324": "Chesapeake N (CN) 11281", "23326": "Chesapeake N (CN) 11281", "23327": "Chesapeake N (CN) 11281", "23325": "Chesapeake N (CN) 11281", "23328": "Chesapeake N (CN) 11281", "Chesapeake S (CS)": "Chesapeake N (CN) 11281", "11284": "Chesapeake N (CN) 11281", "23320": "Chesapeake N (CN) 11281", "Chesapeake (PSP Franchise # 601296)": "Chesapeake N (CN) 11281", "23651": "Hampton North (HN) 11282", "23661": "Hampton North (HN) 11282", "23662": "Hampton North (HN) 11282", "23663": "Hampton North (HN) 11282", "23665": "Hampton North (HN) 11282", "23666": "Hampton North (HN) 11282", "23664": "Hampton North (HN) 11282", "23667": "Hampton North (HN) 11282", "23668": "Hampton North (HN) 11282", "23669": "Hampton North (HN) 11282", "23670": "Hampton North (HN) 11282", "23681": "Hampton North (HN) 11282", "23501": "Norfolk (N) 11593", "23502": "Norfolk (N) 11593", "23503": "Norfolk (N) 11593", "23504": "Norfolk (N) 11593", "23506": "Norfolk (N) 11593", "23507": "Norfolk (N) 11593", "23505": "Norfolk (N) 11593", "23508": "Norfolk (N) 11593", "23509": "Norfolk (N) 11593", "23510": "Norfolk (N) 11593", "23511": "Norfolk (N) 11593", "23513": "Norfolk (N) 11593", "23514": "Norfolk (N) 11593", "23517": "Norfolk (N) 11593", "23518": "Norfolk (N) 11593", "23519": "Norfolk (N) 11593", "23520": "Norfolk (N) 11593", "23521": "Norfolk (N) 11593", "23523": "Norfolk (N) 11593", "23529": "Norfolk (N) 11593", "23541": "Norfolk (N) 11593", "23551": "Norfolk (N) 11593", "23701": "Portsmouth (P) 11594", "23702": "Portsmouth (P) 11594", "23703": "Portsmouth (P) 11594", "23704": "Portsmouth (P) 11594", "23707": "Portsmouth (P) 11594", "23708": "Portsmouth (P) 11594", "23705": "Portsmouth (P) 11594", "23709": "Portsmouth (P) 11594", "27906": "Elizabeth City/OBX (EC) 11283", "27907": "Elizabeth City/OBX (EC) 11283", "27909": "Elizabeth City/OBX (EC) 11283", "27915": "Elizabeth City/OBX (EC) 11283", "27917": "Elizabeth City/OBX (EC) 11283", "27919": "Elizabeth City/OBX (EC) 11283", "27916": "Elizabeth City/OBX (EC) 11283", "27920": "Elizabeth City/OBX (EC) 11283", "27921": "Elizabeth City/OBX (EC) 11283", "27923": "Elizabeth City/OBX (EC) 11283", "27926": "Elizabeth City/OBX (EC) 11283", "27927": "Elizabeth City/OBX (EC) 11283", "27929": "Elizabeth City/OBX (EC) 11283", "27932": "Elizabeth City/OBX (EC) 11283", "27935": "Elizabeth City/OBX (EC) 11283", "27936": "Elizabeth City/OBX (EC) 11283", "27937": "Elizabeth City/OBX (EC) 11283", "27938": "Elizabeth City/OBX (EC) 11283", "27939": "Elizabeth City/OBX (EC) 11283", "27941": "Elizabeth City/OBX (EC) 11283", "27946": "Elizabeth City/OBX (EC) 11283", "27943": "Elizabeth City/OBX (EC) 11283", "27944": "Elizabeth City/OBX (EC) 11283", "27947": "Elizabeth City/OBX (EC) 11283", "27948": "Elizabeth City/OBX (EC) 11283", "27949": "Elizabeth City/OBX (EC) 11283", "27950": "Elizabeth City/OBX (EC) 11283", "27954": "Elizabeth City/OBX (EC) 11283", "27956": "Elizabeth City/OBX (EC) 11283", "27953": "Elizabeth City/OBX (EC) 11283", "27958": "Elizabeth City/OBX (EC) 11283", "27959": "Elizabeth City/OBX (EC) 11283", "27960": "Elizabeth City/OBX (EC) 11283", "27964": "Elizabeth City/OBX (EC) 11283", "27965": "Elizabeth City/OBX (EC) 11283", "27966": "Elizabeth City/OBX (EC) 11283", "27968": "Elizabeth City/OBX (EC) 11283", "27972": "Elizabeth City/OBX (EC) 11283", "27973": "Elizabeth City/OBX (EC) 11283", "27974": "Elizabeth City/OBX (EC) 11283", "27976": "Elizabeth City/OBX (EC) 11283", "27978": "Elizabeth City/OBX (EC) 11283", "27979": "Elizabeth City/OBX (EC) 11283", "27982": "Elizabeth City/OBX (EC) 11283", "27980": "Elizabeth City/OBX (EC) 11283", "27981": "Elizabeth City/OBX (EC) 11283", "23601": "Newport News (NN) 12119", "23602": "Newport News (NN) 12119", "23603": "Newport News (NN) 12119", "23604": "Newport News (NN) 12119", "23605": "Newport News (NN) 12119", "23606": "Newport News (NN) 12119", "23607": "Newport News (NN) 12119", "23608": "Newport News (NN) 12119", "23609": "Newport News (NN) 12119", "23612": "Newport News (NN) 12119", "23628": "Newport News (NN) 12119", "23462": "Kempsville (K) 12120", "23464": "Kempsville (K) 12120", "20141": "Loudoun S (LS) 12188", "20132": "Loudoun S (LS) 12188", "20180": "Loudoun N/Leesburg (LN) 12095", "20197": "Loudoun N/Leesburg (LN) 12095", "20129": "Loudoun N/Leesburg (LN) 12095", "20175": "Loudoun S (LS) 12188", "20158": "Loudoun N/Leesburg (LN) 12095", "20147": "Loudoun E (LE) 12187", "20176": "Loudoun N/Leesburg (LN) 12095", "20131": "Loudoun S (LS) 12188", "20134": "Loudoun N/Leesburg (LN) 12095", "20142": "Loudoun N/Leesburg (LN) 12095", "20159": "Loudoun N/Leesburg (LN) 12095", "20160": "Loudoun N/Leesburg (LN) 12095", "20177": "Loudoun N/Leesburg (LN) 12095", "20178": "Loudoun N/Leesburg (LN) 12095", "Arlington (PSP Franchise # 443253)": "Loudoun N/Leesburg (LN) 12095", "22213": "N Arlington (NA) 12096", "22205": "N Arlington (NA) 12096", "22207": "N Arlington (NA) 12096", "22203": "N Arlington (NA) 12096", "22209": "N Arlington (NA) 12096", "22210": "N Arlington (NA) 12096", "22201": "N Arlington (NA) 12096", "22216": "N Arlington (NA) 12096", "22217": "N Arlington (NA) 12096", "22219": "N Arlington (NA) 12096", "22226": "N Arlington (NA) 12096", "22230": "N Arlington (NA) 12096", "22066": "Vienna/ Great Falls (V) 12097", "22102": "Vienna/ Great Falls (V) 12097", "22182": "Vienna/ Great Falls (V) 12097", "22181": "Vienna/ Great Falls (V) 12097", "22180": "Vienna/ Great Falls (V) 12097", "22031": "Fairfax (F) 12186", "22124": "Fairfax (F) 12186", "22042": "Vienna/ Great Falls (V) 12097", "22027": "Vienna/ Great Falls (V) 12097", "22152": "Vienna/ Great Falls (V) 12097", "22116": "Vienna/ Great Falls (V) 12097", "22183": "Vienna/ Great Falls (V) 12097", "22039": "W Springfield/ Newington (WS)", "22015": "W Springfield/ Newington (WS)", "22079": "W Springfield/ Newington (WS)", "22150": "W Springfield/ Newington (WS)", "22153": "W Springfield/ Newington (WS)", "22151": "W Springfield/ Newington (WS)", "22030": "Fairfax (F) 12186", "22035": "Fairfax (F) 12186", "22033": "Fairfax (F) 12186", "22038": "Fairfax (F) 12186", "22032": "Fairfax (F) 12186", "22185": "Fairfax (F) 12186", "20101": "Loudoun E (LE) 12187", "20103": "Loudoun E (LE) 12187", "20104": "Loudoun E (LE) 12187", "20148": "Loudoun S (LS) 12188", "20149": "Loudoun E (LE) 12187", "20146": "Loudoun E (LE) 12187", "20163": "Loudoun E (LE) 12187", "20164": "Loudoun E (LE) 12187", "20165": "Loudoun E (LE) 12187", "20166": "Loudoun S (LS) 12188", "20167": "Loudoun E (LE) 12187", "20102": "Loudoun S (LS) 12188", "20117": "Loudoun S (LS) 12188", "20120": "Loudoun S (LS) 12188", "20105": "Loudoun S (LS) 12188", "20135": "Loudoun S (LS) 12188", "20152": "Loudoun S (LS) 12188", "20184": "Loudoun S (LS) 12188", "22093": "Loudoun S (LS) 12188"};

    const franchiseNameTranslation = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Richmond",
        "Henrico (H) 10314": "Henrico County",
        "Tri-Cities (T) 8510": "Tri-Cities Plus",
        "Chesapeake N (CN) 11281": "Chesapeake North",
        "Hampton North (HN) 11282": "Hampton North",
        "Norfolk (N) 11593": "Norfolk West",
        "Portsmouth (P) 11594": "Portsmouth",
        "Elizabeth City/OBX (EC) 11283": "Elizabeth City/Outer Banks",
        "Newport News (NN) 12119": "Newport News",
        "Kempsville (K) 12120": "Kempsville/Military Circle",
        "Loudoun N/Leesburg (LN) 12095": "Loudoun County North, Leesburg",
        "N Arlington (NA) 12096": "North Arlington",
        "Vienna/ Great Falls (V) 12097": "Vienna, Great Falls",
        "W Springfield/ Newington (WS)": "West Springfield/Newington",
        "Fairfax (F) 12186": "Fairfax",
        "Loudoun E (LE) 12187": "Loudoun County East",
        "Loudoun S (LS) 12188": "Loudoun County South"
    };

    // ==========================================
    //  CREATEJOB.ASPX - SPECIFIC LOOKUP TABLES
    // ==========================================

    // Which of the 3 "SERVPRO of ___" Office options each franchise belongs to
    const officeGroupMap = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Chesterfield",
        "Henrico (H) 10314": "Chesterfield",
        "Tri-Cities (T) 8510": "Chesterfield",

        "Chesapeake N (CN) 11281": "Chesapeake",
        "Hampton North (HN) 11282": "Chesapeake",
        "Norfolk (N) 11593": "Chesapeake",
        "Portsmouth (P) 11594": "Chesapeake",
        "Elizabeth City/OBX (EC) 11283": "Chesapeake",
        "Newport News (NN) 12119": "Chesapeake",
        "Kempsville (K) 12120": "Chesapeake",

        "Loudoun N/Leesburg (LN) 12095": "Arlington",
        "N Arlington (NA) 12096": "Arlington",
        "Vienna/ Great Falls (V) 12097": "Arlington",
        "W Springfield/ Newington (WS)": "Arlington",
        "Fairfax (F) 12186": "Arlington",
        "Loudoun E (LE) 12187": "Arlington",
        "Loudoun S (LS) 12188": "Arlington"
    };

    // Custom Code (Environmental Code) dropdown text, exactly as it appears on CreateJob.aspx
    const customCodeMap = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Richmond",
        "Henrico (H) 10314": "Henrico",
        "Tri-Cities (T) 8510": "Tri-Cities",
        "Chesapeake N (CN) 11281": "Chesapeake North",
        "Hampton North (HN) 11282": "Hampton",
        "Norfolk (N) 11593": "Norfolk",
        "Portsmouth (P) 11594": "Portsmouth",
        "Elizabeth City/OBX (EC) 11283": "Elizabeth City/OBX",
        "Newport News (NN) 12119": "Newport News",
        "Kempsville (K) 12120": "Kempsville",
        "Loudoun N/Leesburg (LN) 12095": "Loudoun County North, Leesburg",
        "N Arlington (NA) 12096": "North Arlington",
        "Vienna/ Great Falls (V) 12097": "Vienna, Great Falls",
        "W Springfield/ Newington (WS)": "West Springfield, Newington",
        "Fairfax (F) 12186": "Fairfax",
        "Loudoun E (LE) 12187": "Loudoun County East",
        "Loudoun S (LS) 12188": "Loudoun County South"
    };

    // Loss Type -> Secondary Loss Type, keyed by the WC "Type of Loss" value (lowercase)
    const lossTypeMap = {
        "water":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "sewage":     { lossType: "Water",      secondary: "Water Damage Remediation" },
        "storm":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "fire":       { lossType: "Fire",       secondary: "Fire Remediation" },
        "mold":       { lossType: "Mold",       secondary: "Mold Remediation" },
        "bio hazard": { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" },
        "biohazard":  { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" },
        "reconstruction": { lossType: "Reconstruction", secondary: "Reconstruction" },
        // extra keywords matched as whole words inside the Type of Loss text ("Fire/Smoke", "Flood Damage", "Sewer Backup")
        "flood":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "sewer":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "smoke":      { lossType: "Fire",       secondary: "Fire Remediation" },
        "soot":       { lossType: "Fire",       secondary: "Fire Remediation" },
        "trauma":     { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" },
        "hoarding":   { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" }
    };
    const DEFAULT_LOSS_TYPE = { lossType: "Other", secondary: "Other" };

    // Source of Loss options on CreateJob.aspx (for word-matching against Cause of Loss)
    const sourceOfLossOptions = ["Air Conditioner","Air Conditioning Condenser Line","Air Conditioning Drain Pan","Aircraft","Angle Stop","Arson","Bath tub","Bidet","Blocked Rain Gutter","Boat","Candle","Car","Chimney","Cigarette","Clogged Drain","Clogged Toilet","Cold Water Supply Line","Dishwasher","Dishwasher Drain Line","Dishwasher Supply Line","Door Leak","Drain Backup","Drain Line","Dryer","Dryer Vent","Electrical","Falling Object","Fire Hydrant","Fire Sprinkler","Fireplace","Fish Tank","Flood","Frozen Pipe Burst","Furnace","Garbage Disposal","Ground Surface Water","Hose Bib","Hot Water Supply Line","Hurricane","HVAC","HVAC Drain Line","HVAC Freeze","HVAC Pan Overflow","HVAC Pump","HVAC/AC Unit","Ice Maker Supply Line","Instant Water Heater","Landscape Irrigation","Landslide","Lightning","MethLab","Microwave","Mine Subsidence","Mudslide","Oil Rags","Other","Patio Drain","Pipe Break","Pipe Leak","Plumbing","Pool System","Pressure Regulator","Refrigerator","Refrigerator Supply Line","Reverse Osmosis System","Roof","Roof Drain","Roof Leak","Septic System","Sewer","Shower","Shower Cartridge","Shower Drain Line","Shower Head","Shower Pan","Shower Supply Line","Shower/Tub Overflow","Sink","Sink Drain Line","Sink hole","Sink Overflow","Sink Supply Line","Slab LeaK","Small Appliance","Snow","Soft Clog Overflow","Space Heater","Sprinkler System","Steam System","Stove Oven","Strong Winds","Sump Pump Failure","Supply Line","Toilet","Toilet Drain Line","Toilet Overflow","Toilet Supply Line","Toilet Tank","Tornado","Tree","Tree Fall","Truck","Unknown","Vandalism","Vehicle","Vehicle Impact","Washing Machine","Washing Machine Drain Line","Washing Machine Supply Line","Water Filter","Water Heater","Water Heater Supply Line","Water Intrusion","Water Logged","Water Main","Wildfire","Wind-Driven Rain","Window Leak"];

    // CreateJob.aspx Telerik control client IDs
    const CJ = {
        JobName:           "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_JobNameRadTextBox",
        ReportedBy:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DropDown_ReportedBY",
        ReferredBy:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DropDown_ReferredBy",
        LossCategory:      "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_LossCategory",
        LossType:          "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_LossType",
        SecondaryLossType: "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_SecondryLossType",
        SourceOfLoss:      "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_SourceOfLossComboBox",
        Office:            "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBoxOffice",
        CustomCode:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBoxEnvironmentalCode",
        DateOfLoss:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DatePicker_DateOffLoss",
        Estimator:         "ctl00_ContentPlaceHolder1_JobParentInformation_InternalParticpantsControl_InternalParticipantsList_ctl00_EstimatorComboBox",
        InsuranceCarrier:  "ctl00_ContentPlaceHolder1_JobParentInformation_ExternalParticipants_SystemCompanyParticipantCombobox_3",
        TPACompany:        "ctl00_ContentPlaceHolder1_JobParentInformation_ExternalParticipants_SystemCompanyParticipantCombobox_23",
        SelfPayCheckBox:   "ctl00_ContentPlaceHolder1_JobParentInformation_SelfPayJobCheckBox",
        ClaimNumber:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ClaimNumber",
        PolicyNumber:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_PolicyNumber",
        LossDescription:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LossDescription",
        // Customer Information (= billing)
    CustFirstName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_FirstName",
    CustLastName:    "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LastName",
    CustEmail:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Email",
    CustAddress:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Address_Input",
    CustZip:         "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Zip",
    CustCity:        "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_City",
    CustState:       "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_State",
    CustMainPhone:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_MainPhone",
    SameAsCustomer:  "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_SameIndividualAddress",
    // Job Address (= loss)
    LossFirstName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_FirstNameLoss",
    LossLastName:    "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LastNameLoss",
    LossAddress:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_AddressLoss_Input",
    LossZip:         "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ZipLoss",
    LossCity:        "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CityLoss",
    LossState:       "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_StateLoss",
    LossMainPhone:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_MainPhoneLoss",
    // Commercial: Customer As Company Information (= billing)
    CompanyCustomerSearch: "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyCustomer",
    CompanyName:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyName",
    CompanyEmail:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyEmail",
    CompanyAddress:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyAddress_Input",
    CompanyZip:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyZip",
    CompanyCity:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyCity",
    CompanyState:     "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyState",
    CompanyMainPhone: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyMainPhone",
    // Commercial: Company Job Address Information (= loss); POC name goes here
    CompanyJobSameAddr:   "ctl00_ContentPlaceHolder1_JobParentInformation_checkBox_SameCompanyAddress",
    CompanyLossFirstName: "ctl00_ContentPlaceHolder1_JobParentInformation_RadTextBox_NewContactForOfficeFirstName",
    CompanyLossLastName:  "ctl00_ContentPlaceHolder1_JobParentInformation_RadTextBox_NewContactForOfficeLastName",
    CompanyAddressLoss:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyAddressLoss_Input",
    CompanyZipLoss:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyZipLoss",
    CompanyCityLoss:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyCityLoss",
    CompanyStateLoss:     "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyStateLoss",
    CompanyMainPhoneLoss: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyMainPhoneLoss",
    CCFirstName:  "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCFirstName",
    CCLastName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCLastName",
    CCMainPhone:  "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCMainPhone",
    ContactEmail: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ContactEmail",
    };

    // Division checkboxes (label -> checkbox element id)
    const DIVISION_CHECKBOXES = {
        "Mold":              "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_0",
        "Duct Cleaning":     "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_1",
        "Other":             "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_2",
        "Contents":          "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_3",
        "Reconstruction":    "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_4",
        "Pending":           "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_5",
        "Biohazard":         "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_6",
        "Fire":              "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_7",
        "Water":             "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_8",
        "Temporary Repairs": "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_9"
    };

    // Type of Loss (from data key) -> Division checkbox label
    const divisionMap = {
        "water":          "Water",
        "sewage":         "Water",
        "storm":          "Water",
        "fire":           "Fire",
        "mold":           "Mold",
        "bio hazard":     "Biohazard",
        "biohazard":      "Biohazard",
        "reconstruction": "Reconstruction",
        "duct cleaning":  "Duct Cleaning",
        "duct":           "Duct Cleaning",
        "contents":       "Contents",
        "temporary repairs": "Temporary Repairs",
        "flood":          "Water",
        "sewer":          "Water",
        "smoke":          "Fire",
        "soot":           "Fire",
        "trauma":         "Biohazard",
        "hoarding":       "Biohazard"
    };
    const DEFAULT_DIVISION = "Other";

    // ==========================================
    //  SHARED NORMALIZERS (data key values, names, phones, emails, dates)
    // ==========================================
    const EXPECTED_COLUMNS = Object.keys(COLUMN).length;

    // Values that mean "nothing was entered" and must never be typed into a form field.
    // ("unknown" and "no" are NOT here - they are real answers for Cause of Loss / yes-no columns.)
    const PLACEHOLDER_VALUES = new Set(["", "n/a", "na", "n.a.", "none", "null", "undefined", "tbd", "tba", "-", "--", "—", "?", "not applicable", "not available", "not provided", "nil"]);
    function cleanValue(v) {
        if (v === undefined || v === null) return "";
        let s = String(v).replace(/ /g, " ").trim();
        return PLACEHOLDER_VALUES.has(s.toLowerCase()) ? "" : s;
    }

    // Split the pasted key into columns. Returns { data, warning } so the UI can flag a shifted key.
    function parseDataKey(rawData) {
        const data = String(rawData || "").split('|||').map(cleanValue);
        let warning = "";
        if (data.length !== EXPECTED_COLUMNS) {
            warning = `Data key has ${data.length} columns (expected ${EXPECTED_COLUMNS}) - fields may be shifted.`;
            console.warn(warning, data);
        }
        return { data, warning };
    }

    // Regex-escape helper (shared)
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Case-insensitive, word-boundary lookup: "Water Damage" -> map["water"], "Fire/Smoke" -> map["fire"].
    // Exact key wins; otherwise the longest key found as whole words in the text.
    function lookupByKeyword(map, text) {
        const t = (text || "").toLowerCase().trim();
        if (!t) return null;
        if (Object.prototype.hasOwnProperty.call(map, t)) return map[t];
        const keys = Object.keys(map).sort((a, b) => b.length - a.length);
        for (const k of keys) {
            if (new RegExp('\\b' + escapeRe(k).replace(/\s+/g, '\\s+') + '\\b').test(t)) return map[k];
        }
        return null;
    }

    // Name splitting shared by WorkCenter + CreateJob so both pages get the same First / Last.
    // Handles "First Last", "First M. Last", "Last, First", "Mr. John Smith Jr.", "John Smith (Property Manager)", "John Smith - ABC Corp"
    const NAME_PREFIXES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "rev", "prof", "capt", "sgt", "lt", "col", "hon"]);
    const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "esq", "phd", "md", "dds", "cpa"]);
    function splitName(raw) {
        let s = cleanValue(raw)
            .replace(/\s*\([^)]*\)\s*/g, " ")                 // "(Property Manager)"
            .split(/\s+[-–—\/|]\s+/)[0]                 // "John Smith - ABC Corp", "John / Jane"
            .replace(/\s+/g, " ").trim();
        const bare = w => w.replace(/\./g, "").toLowerCase();
        let first = "", last = "";
        if (!s) return { first, last, full: "" };

        let commaParts = s.split(",").map(p => p.trim()).filter(Boolean);
        if (commaParts.length >= 2 && !/\s/.test(commaParts[0])) {
            // "Smith, John" / "Smith, John, Jr."
            last = commaParts[0];
            first = commaParts.slice(1).filter(p => !NAME_SUFFIXES.has(bare(p))).join(" ");
        } else {
            let words = (commaParts[0] || s).split(/\s+/).filter(Boolean);
            while (words.length > 1 && NAME_PREFIXES.has(bare(words[0]))) words.shift();
            while (words.length > 1 && NAME_SUFFIXES.has(bare(words[words.length - 1]))) words.pop();
            if (words.length >= 2) { last = words[words.length - 1]; first = words.slice(0, -1).join(" "); }
            else first = words[0] || "";
        }
        return { first, last, full: [first, last].filter(Boolean).join(" ") };
    }

    // First 10-digit US phone number in a string -> "8045551234" (or "" if none).
    // Ignores extensions, a leading +1 / 1, and a second number after "/" or ",".
    const PHONE_RE = /(?:\+?1[\s.\-]*)?\(?\s*(\d{3})\s*\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})(?!\d)/;
    function extractPhone(raw) {
        const s = cleanValue(raw);
        if (!s) return "";
        const m = s.match(PHONE_RE);
        if (m) return m[1] + m[2] + m[3];
        const digits = s.replace(/\D/g, "");
        if (digits.length === 11 && digits[0] === "1") return digits.slice(1);
        if (digits.length === 10) return digits;
        return "";
    }
    const formatPhoneParens = d => d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "";

    // First well-formed email address in a string (or "")
    function extractEmail(raw) {
        const m = cleanValue(raw).match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
        return m ? m[0] : "";
    }

    // Date column -> JS Date (local midnight). Accepts an Excel serial ("45945"), "10/14/2025", "10-14-25", "2025-10-14", or anything Date can parse.
    // (Previously a "10/14/2025" string was run through parseFloat -> 10 -> Jan 10 1900.)
    function parseDataDate(raw) {
        const s = cleanValue(raw);
        if (!s) return null;
        if (/^\d+(\.\d+)?$/.test(s)) return excelDateToJSDate(parseFloat(s));
        let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (m) {
            let y = parseInt(m[3], 10); if (m[3].length === 2) y += 2000;
            const d = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
            return isNaN(d) ? null : d;
        }
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        const d = new Date(s);
        return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    // Resolve the loss/billing pair, honoring "same as ..." shorthand in either field.
    // billingSameAsLoss drives the "Same as Customer" checkbox (CreateJob) / "Same as Caller" kicker (WorkCenter).
    function resolveAddressPair(lossRaw, billingRaw) {
        let loss = cleanValue(lossRaw), billing = cleanValue(billingRaw);
        const saysSame = s => /\bsame\b/i.test(s) && !/\d/.test(s);   // "Same as loss", but not "123 Same St"
        const lossSame = saysSame(loss), billingSame = saysSame(billing);
        if (lossSame && billingSame) {
            console.warn("Both Loss and Billing address say 'same as ...' - no real address in the data key");
            loss = ""; billing = "";
        } else if (lossSame) {
            loss = billing;
        }
        const billingSameAsLoss = billingSame || !billing || (!!loss && billing.toLowerCase() === loss.toLowerCase());
        if (billingSameAsLoss) billing = loss;
        return { loss, billing, billingSameAsLoss };
    }

// --- Floating UI Setup ---
    const isDash = location.hostname.includes('ngsapps.net');
    const themeColor = isDash ? '#007CB9' : '#ff8200';

    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '270px';
    panel.style.right = '20px';
    panel.style.zIndex = '9999';
    panel.style.backgroundColor = '#fff';
    panel.style.border = `2px solid ${themeColor}`;
    panel.style.padding = '0';
    panel.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
    panel.style.borderRadius = '4px';
    panel.style.overflow = 'hidden';
    panel.style.width = '272px';

    // Header bar (drag handle + close button)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.backgroundColor = themeColor;
    header.style.color = '#fff';
    header.style.padding = '6px 10px';
    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    header.style.fontFamily = 'Arial, sans-serif';
    header.style.fontSize = '13px';
    header.style.fontWeight = 'bold';

    const title = document.createElement('span');
    title.innerText = 'Intake Autofill v' + SCRIPT_VERSION;

    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close (until page refresh)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.lineHeight = '14px';
    closeBtn.style.padding = '0 2px';
    closeBtn.addEventListener('click', () => panel.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body (input + button)
    const body = document.createElement('div');
    body.style.padding = '10px';

    const inputBox = document.createElement('textarea');
    inputBox.placeholder = 'Paste data key here...';
    inputBox.style.width = '250px';
    inputBox.style.height = '60px';
    inputBox.style.marginBottom = '5px';
    inputBox.style.display = 'block';
    inputBox.style.boxSizing = 'border-box';

    const btn = document.createElement('button');
    btn.innerText = 'Autofill Form';
    btn.style.width = '100%';
    btn.style.backgroundColor = themeColor;
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.padding = '8px';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '3px';

    const statusLine = document.createElement('div');
    statusLine.style.fontFamily = 'Arial, sans-serif';
    statusLine.style.fontSize = '11px';
    statusLine.style.marginTop = '6px';
    statusLine.style.minHeight = '14px';
    statusLine.style.color = '#444';
    statusLine.style.whiteSpace = 'normal';
    function setStatus(msg, isError) {
        statusLine.textContent = msg || '';
        statusLine.style.color = isError ? '#c0392b' : '#444';
    }

    body.appendChild(inputBox);
    body.appendChild(btn);
    body.appendChild(statusLine);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // --- Drag-to-move logic ---
    (function makeDraggable() {
        let dragging = false, offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            // Don't start a drag when clicking the close button
            if (e.target === closeBtn) return;
            dragging = true;
            let rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            // Switch from right-anchored to left-anchored so dragging works smoothly
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.right = 'auto';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;
            // Keep it within the viewport
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - panel.offsetHeight));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => { dragging = false; });
    })();

    // ==========================================
    //  SHARED HELPER FUNCTIONS
    // ==========================================

        const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Plain RadInput textbox setter (for First/Last/Email/Zip/City)
    // Zip -> wait for the page's zip lookup -> THEN city + state
    // ids = { zip, city, state } (CJ keys' element ids), parsed = parseAddress() result
    async function fillZipCityState(ids, parsed) {
        const stEl = document.getElementById(ids.state);
        const stateVal = () => { const c = stEl && getCurrentDropdownValue(stEl); return (c && c.value) || ""; };
        let lookupDone = false;

        if (parsed.zip) {
            const before = stateVal();
            setPlainTextBox(ids.zip, parsed.zip);   // fires the page's own zip lookup
            let kicked = false;
            const start = Date.now();
            while (Date.now() - start < 3000) {
                await sleep(250);
                if (stateVal() && stateVal() !== before) { lookupDone = true; break; }
                if (!kicked && Date.now() - start > 1200) { triggerZipBind(ids.zip); kicked = true; }
            }
            console.log(`Zip ${parsed.zip}: page lookup ${lookupDone ? "populated" : "did NOT change"} state (${ids.state.split('_').pop()})`);
        }

        if (parsed.city) {
            const pageCity = (document.getElementById(ids.city) || {}).value || "";
            if (pageCity && pageCity.toLowerCase().trim() !== parsed.city.toLowerCase()) {
                console.log(`⚠ Zip lookup city "${pageCity}" differs from parsed city "${parsed.city}" - using parsed value`);
            }
            setPlainTextBox(ids.city, parsed.city);
        }

        // Trust the page's zip lookup if it filled the state; only set it ourselves otherwise.
        // Try "VA" then "Virginia" - the list text differs between controls.
        if (parsed.state && stEl && !lookupDone) {
            for (const candidate of stateCandidates(parsed.state)) {
                if (setRadComboByText(stEl, candidate, true)) break;
            }
        }
    }

function setPlainTextBox(id, value) {
        if (!value) return;
        let el = document.getElementById(id);
        if (!el) return;
        // Prefer the Telerik client object so framework state (and the gray placeholder) clears properly
        let tb = window.$find && window.$find(id);
        if (tb && tb.set_value) {
            try { tb.set_value(value); } catch (e) {}
        }
        el.value = value;
        el.classList.remove('riEmpty', 'rcbEmptyMessage', 'rsbEmptyMessage');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        let hidden = document.getElementById(id + "_ClientState");
        if (hidden) {
            try {
                let s = JSON.parse(hidden.value);
                s.valueAsString = value;
                s.lastSetTextBoxValue = value;
                hidden.value = JSON.stringify(s);
            } catch (e) {}
        }
        console.log(`✓ Set ${id} → ${value}`);
    }

    // Masked phone setter ( mask is _-___-___-____ → 1-XXX-XXX-XXXX )
    function setMaskedPhone(id, rawPhone) {
        if (!rawPhone) return;
        let digits = extractPhone(rawPhone);                   // first 10-digit number only (ignores extensions / second numbers)
        if (!digits) { console.log(`⚠ Skipped phone ${id}: no 10-digit number in "${rawPhone}"`); return; }
        digits = "1" + digits;                                 // prepend country code
        let formatted = `${digits[0]}-${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7,11)}`;

        let el = document.getElementById(id);
        if (!el) return;

        // Commit through the Telerik MaskedTextBox client object so the mask state updates
        let mtb = window.$find && window.$find(id);
        if (mtb) {
            try {
                if (mtb.set_value) mtb.set_value(formatted);
                // RadMaskedTextBox stores the unmasked value separately; set both if available
                if (mtb._setValue) mtb._setValue(formatted);
                if (mtb.get_element) {
                    let inner = mtb.get_element();
                    if (inner) inner.value = formatted;
                }
                if (mtb.updateCssClass) mtb.updateCssClass();
            } catch (e) {}
        }

        el.value = formatted;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));

        let hidden = document.getElementById(id + "_ClientState");
        if (hidden) {
            try {
                let s = JSON.parse(hidden.value);
                s.valueAsString = formatted;
                s.valueWithPromptAndLiterals = formatted;
                s.lastSetTextBoxValue = formatted;
                hidden.value = JSON.stringify(s);
            } catch (e) {}
        }
        console.log(`✓ Set phone ${id} → ${formatted}`);
    }

    // RadSearchBox address setter (Address fields are RadSearchBox, not RadComboBox)
    function setSearchBoxAddress(id, value) {
        if (!value) return;
        let el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        el.classList.remove('rsbEmptyMessage');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✓ Set address ${id} → ${value}`);
    }

    // Excel serial -> local-midnight JS Date. Uses UTC getters so it is correct in any timezone
    // (the old "+1 day" trick only worked west of UTC).
    function excelDateToJSDate(serial) {
        serial = parseFloat(serial);
        if (!serial || isNaN(serial)) return null;
        const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    // ==========================================
    //  ADDRESS PARSER
    //  Handles: "123 Main St, Richmond, VA 23220" / "123 Main St Richmond VA 23220-1234" /
    //           "123 Main St, Apt 4, Richmond, Virginia 23220" / "123 Main Street Apt 4 Newport News VA" /
    //           multi-line pastes / "Richmond, VA 23220" (no street) / "Acme Corp, 123 Main St, ..." / trailing USA
    // ==========================================
    const US_STATES = {
        "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE",
        "District of Columbia":"DC","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
        "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN",
        "Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
        "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI",
        "South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
        "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"
    };
    const US_STATE_CODES = new Set(Object.values(US_STATES));
    const STATE_NAME_BY_CODE = {};
    for (const [name, code] of Object.entries(US_STATES)) if (!STATE_NAME_BY_CODE[code]) STATE_NAME_BY_CODE[code] = name;
    const STATE_NAME_ALT = Object.keys(US_STATES).sort((a, b) => b.length - a.length).map(n => escapeRe(n).replace(/\s+/g, '\\s+')).join('|');
    function stateCodeFrom(s) {
        const t = (s || "").trim().replace(/\s+/g, ' ');
        if (!t) return "";
        if (t.length === 2) return US_STATE_CODES.has(t.toUpperCase()) ? t.toUpperCase() : "";
        const k = Object.keys(US_STATES).find(n => n.toLowerCase() === t.toLowerCase());
        return k ? US_STATES[k] : "";
    }
    // Texts to try on a state dropdown, in order: "VA" then "Virginia" (the two pages list states differently)
    function stateCandidates(code) {
        if (!code) return [];
        const c = code.toUpperCase();
        return STATE_NAME_BY_CODE[c] ? [c, STATE_NAME_BY_CODE[c]] : [c];
    }

    // Street suffixes that reliably end a street line (deliberately excludes words common in city names: Hill, Park, Ridge, Springs...)
    const STREET_SUFFIXES = new Set(['street','st','avenue','ave','av','road','rd','boulevard','blvd','drive','dr','lane','ln','court','ct','place','pl',
        'terrace','ter','terr','parkway','pkwy','pky','pike','highway','hwy','way','circle','cir','trail','trl','loop','square','sq','plaza','plz',
        'turnpike','tpke','alley','aly','crossing','xing','cove','cv','bend','bnd','extension','ext','freeway','fwy','expressway','expy','causeway','cswy',
        'bypass','byp','route','rte','path','row','walk','trace','trce','crescent','cres','commons','cmns','manor','mnr','hollow','holw','knoll','knl']);
    const UNIT_WORD_RE = /^(apt|apartment|unit|suite|ste|bldg|building|fl|floor|lot|rm|room|trlr|trailer|ofc|office|dept|pmb|spc|space|no)\.?$/i;
    const UNIT_PART_RE = /^(?:(?:apt|apartment|unit|suite|ste|bldg|building|fl|floor|lot|rm|room|trlr|trailer|ofc|office|dept|pmb|spc|space|#)\.?\s*\S+|#?\d+[a-z]?|\d+(?:st|nd|rd|th)?\s*(?:floor|fl)\.?)$/i;
    const DIRECTIONAL_RE = /^(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\.?$/i;

    // Multi-word city names in / around the service area, so "123 Main St Virginia Beach VA" splits correctly without commas.
    const MULTI_WORD_CITIES = [
        // Richmond / Tri-Cities
        "North Chesterfield","South Chesterfield","Glen Allen","Highland Springs","Bon Air","Short Pump","Colonial Heights","Prince George",
        "South Prince George","Fort Lee","Fort Gregg-Adams","Church Road","New Kent","King William","West Point","Charles City","Ruther Glen",
        "Manakin Sabot","Manakin-Sabot","Stony Creek","South Hill","North Dinwiddie","Spring Grove","Lake Monticello",
        // Hampton Roads
        "Virginia Beach","Newport News","Fort Monroe","Fort Eustis","Isle of Wight","Cape Charles","Oak Hall","Chincoteague Island","Wallops Island",
        "Great Bridge","Deep Creek","Western Branch","South Norfolk","Ocean View","Buckroe Beach","Fox Hill","Lee Hall","James City","Battery Park",
        // NC / Outer Banks
        "Elizabeth City","Kill Devil Hills","Kitty Hawk","Nags Head","Southern Shores","Point Harbor","Powells Point","South Mills","Knotts Island",
        "Manns Harbor","Stumpy Point","Swan Quarter","Cape Hatteras","Pine Island","Roanoke Island",
        // Northern Virginia / DC / MD
        "Falls Church","West Falls Church","East Falls Church","Great Falls","Fairfax Station","South Riding","Stone Ridge","Round Hill",
        "Paeonian Springs","West Springfield","North Springfield","North Arlington","Tysons Corner","Dunn Loring","Oak Hill","Fort Belvoir",
        "Mount Vernon","Rose Hill","Seven Corners","Baileys Crossroads","Bailey's Crossroads","Lake Ridge","Dale City","Manassas Park",
        "The Plains","Potomac Falls","Sugarland Run","One Loudoun","Fair Oaks","Fair Lakes","Kings Park","Burke Centre","Crystal City",
        "Pentagon City","Virginia Square","Chevy Chase","Silver Spring","Takoma Park","College Park","Oxon Hill","Fort Washington",
        "National Harbor","Indian Head","La Plata","Saint Charles","St Charles","St. Charles","Bryans Road","Capitol Heights","District Heights",
        "Temple Hills","Camp Springs","New Carrollton","Glenn Dale","Upper Marlboro","Bull Run"
    ];
    const normCity = s => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
        .replace(/^n /, 'north ').replace(/^s /, 'south ').replace(/^e /, 'east ').replace(/^w /, 'west ');
    const MULTI_WORD_CITY_SET = new Set(MULTI_WORD_CITIES.map(normCity));

    // Number of trailing words that form a known multi-word city (0 = none). Always leaves >= 2 words for the street.
    function trailingCityWords(words) {
        for (let n = Math.min(4, words.length - 2); n >= 2; n--) {
            if (MULTI_WORD_CITY_SET.has(normCity(words.slice(-n).join(' ')))) return n;
        }
        return 0;
    }
    const isSuffixWord = w => STREET_SUFFIXES.has(w.toLowerCase().replace(/\.$/, ''));
    const looksLikeStreet = s => /\d/.test(s) || /\bp\.?\s?o\.?\s*box\b/i.test(s) || s.split(/\s+/).some(isSuffixWord);

    function parseAddress(raw) {
        const result = { street: "", city: "", state: "", zip: "" };
        if (!raw) return result;

        let cleanStr = String(raw).replace(/ /g, ' ')
            .replace(/\s*[\r\n]+\s*/g, ', ')                       // multi-line paste -> comma separated
            .replace(/\s+/g, ' ').trim();
        cleanStr = cleanStr.replace(/[,\s]*\b(U\.?S\.?A?\.?|United States(?: of America)?)\s*$/i, '').trim();
        cleanStr = cleanStr.replace(/[,\s.]+$/, '');

        // 1. State (code OR full name) + zip, anywhere in the string; keep the LAST valid match
        const stateZipRe = new RegExp('\\b([A-Za-z]{2}|' + STATE_NAME_ALT + ')\\.?[,\\s]+(\\d{5})(?:-\\d{4})?\\b', 'gi');
        let m, found = null;
        while ((m = stateZipRe.exec(cleanStr)) !== null) {
            let code = stateCodeFrom(m[1]);
            if (!code) continue;
            const before = cleanStr.slice(0, m.index);
            const isCode = m[1].length === 2;
            // "123 Main Ct 23220" / "123 Main St NE 20002": CT / NE here is a suffix or directional, not a state,
            // unless a comma or a city precedes it
            if (isCode && (code === 'CT' || code === 'NE') && !/,\s*$/.test(before) && before.trim().split(/\s+/).length <= 3) continue;
            let removeFrom = m.index;
            // "Washington 20001" (no DC): that's the city, not Washington State
            if (!isCode && code === 'WA' && /^20[0-5]/.test(m[2])) { code = 'DC'; removeFrom = m.index + m[1].length; }
            found = { from: removeFrom, to: m.index + m[0].length, code, zip: m[2] };
        }
        if (found) {
            result.state = found.code;
            result.zip = found.zip;
            cleanStr = cleanStr.slice(0, found.from) + cleanStr.slice(found.to);
        } else {
            // 2. Trailing zip with no state ("Richmond, 23220")
            const zipOnly = cleanStr.match(/(?:^|[,\s]+)(\d{5})(?:-\d{4})?\s*$/);
            if (zipOnly) { result.zip = zipOnly[1]; cleanStr = cleanStr.slice(0, zipOnly.index); }
            // 3. Trailing state with no zip: full name ("Richmond, Virginia") - "Washington" alone is treated as the city
            const nameAlt = STATE_NAME_ALT.split('|').filter(n => n.toLowerCase() !== 'washington').join('|');
            const nameOnly = cleanStr.match(new RegExp('(?:^|[,\\s]+)(' + nameAlt + ')\\.?\\s*$', 'i'));
            if (nameOnly) {
                result.state = stateCodeFrom(nameOnly[1]);
                cleanStr = cleanStr.slice(0, nameOnly.index);
            } else {
                // ... or a 2-letter code ("Richmond, VA" / "Richmond VA"). Without a comma it must be upper-case and
                // not a code that doubles as an English word / street abbreviation (CT, NE, CO, IN, OR, DE, LA, ME, OK, OH, ID, HI).
                const codeOnly = cleanStr.match(/([,\s]+)([A-Za-z]{2})\.?\s*$/);
                if (codeOnly) {
                    const code = codeOnly[2].toUpperCase();
                    const afterComma = codeOnly[1].includes(',');
                    const upper = codeOnly[2] === code;
                    const ambiguous = new Set(['CT','NE','CO','IN','OR','DE','LA','ME','OK','OH','ID','HI']);
                    if (US_STATE_CODES.has(code) && (afterComma || (upper && !ambiguous.has(code)))) {
                        result.state = code;
                        cleanStr = cleanStr.slice(0, codeOnly.index);
                    }
                }
            }
        }
        cleanStr = cleanStr.replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+,/g, ',').trim();
        if (!cleanStr) return result;

        // 4. Street / city split
        if (cleanStr.includes(',')) {
            let parts = cleanStr.split(',').map(p => p.trim()).filter(Boolean);
            // "Acme Corp, 123 Main St, Richmond": drop a leading name line when the next part starts with a house number
            if (parts.length >= 2 && !looksLikeStreet(parts[0]) && /^\d/.test(parts[1])) parts.shift();
            let street = parts.shift() || "";
            // "123 Main St, Apt 4, Richmond" / "123 Main St, #12, Richmond": fold unit parts into the street line
            while (parts.length && UNIT_PART_RE.test(parts[0])) street += " " + parts.shift();
            if (!parts.length && !looksLikeStreet(street)) {        // "Richmond, Henrico County" style: no street at all
                result.city = street;
            } else {
                result.street = street;
                result.city = parts[0] || "";
            }
        } else {
            const words = cleanStr.split(' ');
            if (!/\d/.test(cleanStr) && !looksLikeStreet(cleanStr)) {       // "Virginia Beach"
                result.city = cleanStr;
                return result;
            }
            const splitAt = n => { result.street = words.slice(0, n).join(' '); result.city = words.slice(n).join(' '); };
            const tail = trailingCityWords(words);
            let suffixIdx = -1;
            for (let i = words.length - 1; i >= 1; i--) { if (isSuffixWord(words[i])) { suffixIdx = i; break; } }

            if (tail) {
                splitAt(words.length - tail);                                  // "123 Main St Apt 4 Newport News"
            } else if (suffixIdx !== -1) {
                let j = suffixIdx + 1;
                // Absorb unit designators that follow the suffix: "Apt 4B", "Suite 200", "#12", "Unit B"
                while (j < words.length) {
                    if (/^#/.test(words[j])) { j += 1; continue; }
                    if (UNIT_WORD_RE.test(words[j]) && j + 1 < words.length) { j += 2; continue; }
                    break;
                }
                // Absorb a directional ("Main St NW Washington", "Main St NE") unless it starts a known city ("N Chesterfield")
                if (j < words.length && DIRECTIONAL_RE.test(words[j]) && (j === words.length - 1 || !MULTI_WORD_CITY_SET.has(normCity(words.slice(j).join(' '))))) j += 1;
                if (j < words.length) splitAt(j);
                else result.street = cleanStr;                                 // suffix is the last word: no city present
            } else if (words.length >= (/^\d/.test(words[0]) ? 3 : 4)) {
                splitAt(words.length - 1);                                     // "123 Broadway Richmond" / "PO Box 12 Richmond"
            } else {
                result.street = cleanStr;
            }
        }
        result.street = result.street.replace(/\s+/g, ' ').trim();
        result.city = result.city.replace(/\s+/g, ' ').trim();
        return result;
    }

    // City-name fallbacks (word-boundary regexes) used only when the zip is not in zipToFranchiseMap.
    // Order matters: more specific names first (Fairfax Station -> WS before Fairfax -> F, Falls Church -> V, etc.).
    const cityToFranchiseFallback = [
        [/\b(virginia|va)\.?\s+beach\b/,                                                                   "Kempsville (K) 12120"],
        [/\bchesterfield\b|\bchester\b|\bmidlothian\b|\bmoseley\b|\bbon air\b/,                            "Chesterfield (C) 5248"],
        [/\brichmond\b/,                                                                                  "Richmond (R) 10313"],
        [/\bhenrico\b|\bglen allen\b|\bshort pump\b|\bsandston\b|\bhighland springs\b|\bmechanicsville\b|\btuckahoe\b/, "Henrico (H) 10314"],
        [/\bpetersburg\b|\bhopewell\b|\bcolonial heights\b|\bprince george\b|\bdinwiddie\b|\bfort (lee|gregg)/, "Tri-Cities (T) 8510"],
        [/\bchesapeake\b/,                                                                                "Chesapeake N (CN) 11281"],
        [/\bhampton\b|\bpoquoson\b|\bfort monroe\b/,                                                      "Hampton North (HN) 11282"],
        [/\bnorfolk\b/,                                                                                   "Norfolk (N) 11593"],
        [/\bportsmouth\b/,                                                                                "Portsmouth (P) 11594"],
        [/\bnewport news\b|\bfort eustis\b/,                                                              "Newport News (NN) 12119"],
        [/\belizabeth city\b|\bkill devil hills\b|\bkitty hawk\b|\bnags head\b|\bmanteo\b|\bcorolla\b|\bduck\b|\bmoyock\b|\bcurrituck\b|\bcamden\b|\bouter banks\b|\bobx\b|\bsouthern shores\b|\bhatteras\b/, "Elizabeth City/OBX (EC) 11283"],
        [/\bleesburg\b|\bpurcellville\b|\blovettsville\b|\bhamilton\b|\bround hill\b|\bwaterford\b|\blucketts\b|\bbluemont\b|\bhillsboro\b/, "Loudoun N/Leesburg (LN) 12095"],
        [/\bsterling\b|\bdulles\b|\blansdowne\b|\bbroadlands\b|\bcascades\b|\bpotomac falls\b/,           "Loudoun E (LE) 12187"],
        [/\baldie\b|\bchantilly\b|\bsouth riding\b|\bstone ridge\b|\bmiddleburg\b|\bbrambleton\b|\bcentreville\b/, "Loudoun S (LS) 12188"],
        [/\barlington\b/,                                                                                 "N Arlington (NA) 12096"],
        [/\bvienna\b|\bgreat falls\b|\btysons\b|\bmclean\b|\bmerrifield\b|\bdunn loring\b|\bfalls church\b/, "Vienna/ Great Falls (V) 12097"],
        [/\bfairfax station\b|\bspringfield\b|\bnewington\b|\bburke\b|\blorton\b/,                        "W Springfield/ Newington (WS)"],
        [/\bfairfax\b|\boakton\b|\bfair oaks\b|\bfair lakes\b/,                                           "Fairfax (F) 12186"]
    ];

    // Comprehensive Fallback Resolver for Franchise: zip map -> city name -> Environmental Code
    function resolveFranchise(zip, city, envCode) {
        zip = (zip || "").trim();
        if (zip && zipToFranchiseMap[zip]) return zipToFranchiseMap[zip];

        let cLower = normCity(city || "");

        // Tri-Cities will be any zip code that starts with 238 (except for Chester & Chesterfield, which the zip map already covers)
        if (zip && zip.startsWith("238") && !/\bchester(field)?\b/.test(cLower)) return "Tri-Cities (T) 8510";

        // City-name fallback (word-boundary, so "Winchester" no longer lands in Chesterfield)
        for (const [re, key] of cityToFranchiseFallback) {
            if (re.test(cLower)) return key;
        }

        // The other fall back for this is that the Environmental code should be provided when the FNOL is submitted, so fall back to that if it's not in the zip range.
        if (envCode) {
            let eLower = envCode.toLowerCase().trim();
            for (let key in customCodeMap) {
                if (customCodeMap[key].toLowerCase() === eLower) return key;
            }
            for (let key in franchiseNameTranslation) {
                if (franchiseNameTranslation[key].toLowerCase() === eLower) return key;
            }
            // Loose: the env code text names a franchise ("Henrico", "Loudoun County East")
            for (let key in customCodeMap) {
                if (customCodeMap[key].toLowerCase().includes(eLower) || eLower.includes(customCodeMap[key].toLowerCase())) return key;
            }
        }

        return null;
    }

        // Commits a value to the KO observable bound to the element (reads its data-bind), then fires DOM events.
    function setKOValue(selector, value, verify = false) {
        if (value === undefined || value === null || value === "") return false;
        const el = document.querySelector(selector);
        if (!el) { console.log(`✗ setKOValue: ${selector} not found`); return false; }

        const commit = () => {
            let committed = false;
            if (window.ko) {
                try {
                    const bind = el.getAttribute('data-bind') || "";
                    let expr = null;
                    if (window.ko.expressionRewriting && window.ko.expressionRewriting.parseObjectLiteral) {
                        const pairs = window.ko.expressionRewriting.parseObjectLiteral(bind);
                        const p = pairs.find(x => x.key === 'value' || x.key === 'textInput');
                        if (p) expr = p.value;
                    }
                    if (!expr) {
                        const m = bind.match(/(?:textInput|value)\s*:\s*([^,]+)/);
                        if (m) expr = m[1].trim();
                    }
                    if (expr) {
                        const ctx = window.ko.contextFor(el);
                        const target = new Function('$context', 'with($context){with($data||{}){return (' + expr + ');}}')(ctx);
                        if (window.ko.isWriteableObservable(target)) { target(value); committed = true; }
                    }
                } catch (e) {
                    console.log(`setKOValue KO commit failed for ${selector}:`, e.message);
                }
            }
            el.value = value;
            if (window.jQuery) window.jQuery(el).val(value);
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur',   { bubbles: true }));
            return committed;
        };

        const committed = commit();
        console.log(committed ? `✓ KO-committed ${selector} → ${value}` : `⚠ DOM-only ${selector} → ${value}`);

        if (verify) {
            setTimeout(() => {
                if (el.value !== String(value)) {
                    console.log(`↻ ${selector} was reset to "${el.value}" - re-applying`);
                    commit();
                }
            }, 1200);
        }
        return committed;
    }

    // Dedicated setter for the Project Notes textarea (#journalNote).
    // The real KO property is RMLead().LossNote; setting only the textarea's DOM value
    // gets overwritten by the framework, so this walks the KO context and commits directly.
    function setJournalNote(value) {
        if (!value) return;
        let el = document.getElementById('journalNote');
        if (!el) return;

        let committed = false;
        if (window.ko) {
            try {
                let context = window.ko.contextFor(el);
                let vm = context ? (context.$data || context.$root) : null;
                if (vm && typeof vm.RMLead === 'function') {
                    let lead = vm.RMLead();
                    if (lead && typeof lead.LossNote === 'function') {
                        lead.LossNote(value);
                        committed = true;
                    }
                }
            } catch (e) {
                console.log("setJournalNote KO update failed:", e.message);
            }
        }

        el.value = value;
        if (window.jQuery) window.jQuery(el).val(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log(committed
            ? `✓ Set journalNote (Project Notes, KO-committed) → ${value}`
            : `⚠ Set journalNote (DOM only, KO commit failed) → ${value}`);
    }

    // PREDICATE KENDO ENGINE - Zero Mathematical Offsets (WorkCenter)
    // `text` may be a string or an array of candidate strings (tried in order for an exact match).
    // Returns true when something other than the placeholder ended up selected.
    function setKendoDropdownExact(elementId, text) {
        if (!window.jQuery || !text) return false;
        const candidates = (Array.isArray(text) ? text : [text]).filter(Boolean).map(t => String(t).toLowerCase().trim()).filter(Boolean);
        if (!candidates.length) return false;
        let el = window.jQuery(`#${elementId}`);
        let widget = el.data("kendoDropDownList") || el.data("kendoComboBox");
        if (!widget) { console.log(`✗ Kendo widget not found: #${elementId}`); return false; }

        const itemText = dataItem => {
            if (dataItem === null || dataItem === undefined) return "";
            if (typeof dataItem === 'string') return dataItem;
            let tField = widget.options.dataTextField;
            if (tField && dataItem[tField]) return dataItem[tField].toString();
            return (dataItem.Name || dataItem.name || dataItem.Text || dataItem.text || dataItem.Description || "").toString();
        };
        const isPlaceholder = () => {
            let d = widget.dataItem();
            return !d || /select/i.test(itemText(d));
        };
        const trySelect = pred => {
            widget.select(pred);
            return widget.selectedIndex !== -1 && !isPlaceholder();
        };

        const prevValue = widget.value();
        let ok = false;
        for (const target of candidates) {
            if (trySelect(d => itemText(d).toLowerCase().trim() === target)) { ok = true; break; }
        }

        // Fuzzy fallback on the primary candidate only - never for 2-letter codes ("VA" is inside "Nevada")
        const target = candidates[0];
        if (!ok && target.length > 2) {
            ok = trySelect(d => {
                let lowerItem = itemText(d).toLowerCase().trim();
                if (!lowerItem || lowerItem.includes("please select")) return false;
                if (lowerItem.includes(target) || target.includes(lowerItem)) return true;
                // Person-name style: same last word and a shared first-name start ("Mike Smith" ~ "Michael Smith", but not "Jon" ~ "Jane")
                let targetWords = target.split(/\s+/), itemWords = lowerItem.split(/\s+/);
                if (targetWords.length > 1 && itemWords.length > 1 && itemWords[itemWords.length - 1] === targetWords[targetWords.length - 1]) {
                    let a = targetWords[0], b = itemWords[0];
                    return a.startsWith(b) || b.startsWith(a) || (a.length >= 2 && a.slice(0, 2) === b.slice(0, 2));
                }
                return false;
            });
        }

        if (!ok) {
            // Nothing matched: put the previous selection back instead of leaving the control cleared
            try { widget.value(prevValue); } catch (e) {}
            console.log(`✗ No match for "${Array.isArray(text) ? text.join('" / "') : text}" in #${elementId}`);
            return false;
        }
        widget.trigger("change");
        if (el[0]) el[0].dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✓ Set #${elementId} → ${itemText(widget.dataItem())}`);
        return true;
    }

    // --- Reported By mapping (shared) ---
    function mapReportedBy(reportedByRaw) {
        let reportedBy = "Other";
        let reportedByLower = (reportedByRaw || "").toLowerCase().trim();

        if (reportedByLower.includes("adjuster")) {
            reportedBy = "Adjuster";
        } else if (reportedByLower.includes("bank")) {
            reportedBy = "Bank";
        } else if (reportedByLower.includes("broker") || reportedByLower.includes("agent")) {
            reportedBy = "Broker/Agent";
        } else if (reportedByLower.includes("child")) {
            reportedBy = "Child";
        } else if (reportedByLower.includes("decision maker") || reportedByLower.includes("company decision")) {
            reportedBy = "Company Decision Maker";
        } else if (reportedByLower.includes("consultant")) {
            reportedBy = "Consultant";
        } else if (reportedByLower.includes("customer")) {
            reportedBy = "Customer";
        } else if (reportedByLower.includes("employee")) {
            reportedBy = "Employee";
        } else if (reportedByLower.includes("estate executor") || reportedByLower.includes("executor")) {
            reportedBy = "Estate Executor";
        } else if (reportedByLower.includes("facility manager")) {
            reportedBy = "Facility Manager";
        } else if (reportedByLower.includes("friend")) {
            reportedBy = "Friend";
        } else if (reportedByLower.includes("general contractor") || reportedByLower.includes("contractor")) {
            reportedBy = "General Contractor";
        } else if (reportedByLower.includes("government agency") || reportedByLower.includes("government")) {
            reportedBy = "Government Agency";
        } else if (reportedByLower.includes("holding company")) {
            reportedBy = "Holding Company";
        } else if (reportedByLower.includes("incident alert") || reportedByLower.includes("iac")) {
            reportedBy = "Incident Alert Center (IAC)";
        } else if (reportedByLower.includes("initial contact")) {
            reportedBy = "Initial Contact";
        } else if (reportedByLower.includes("marketing rep")) {
            reportedBy = "Marketing Rep";
        } else if (reportedByLower.includes("neighbor")) {
            reportedBy = "Neighbor";
        } else if (reportedByLower.includes("occupant") || reportedByLower.includes("tenant")) {
            reportedBy = "Occupant/Tenant";
        } else if (reportedByLower.includes("onsite")) {
            reportedBy = "Onsite Contact";
        } else if (reportedByLower.includes("relative") || reportedByLower.includes("family")) {
            reportedBy = "Other Relative";
        } else if (reportedByLower.includes("owner")) {
            reportedBy = "Owner";
        } else if (reportedByLower.includes("parent") && !reportedByLower.includes("parent company")) {
            reportedBy = "Parent";
        } else if (reportedByLower.includes("parent company")) {
            reportedBy = "Parent Company";
        } else if (reportedByLower.includes("partner")) {
            reportedBy = "Partner";
        } else if (reportedByLower.includes("power of attorney")) {
            reportedBy = "Power of Attorney Holder";
        } else if (reportedByLower.includes("property manager")) {
            reportedBy = "Property Manager";
        } else if (reportedByLower.includes("realtor")) {
            reportedBy = "Realtor";
        } else if (reportedByLower.includes("servpro franchise") && !reportedByLower.includes("hq")) {
            reportedBy = "SERVPRO® Franchise";
        } else if (reportedByLower.includes("servpro hq") || reportedByLower.includes("hq priority")) {
            reportedBy = "SERVPRO® HQ Priority Response Specialist";
        } else if (reportedByLower.includes("spouse")) {
            reportedBy = "Spouse";
        } else if (reportedByLower.includes("tpa")) {
            reportedBy = "TPA Handler";
        } else {
            reportedBy = "Other";
        }
        return reportedBy;
    }

    // Reported By for CreateJob - maps to the combo's EXACT option text
    function mapReportedByCreateJob(reportedByRaw, isCommercial) {
        let r = (reportedByRaw || "").toLowerCase().trim();

        if (r.includes("adjuster")) return "Adjuster-Insurance";
        if (r.includes("insurance agent") || (r.includes("agent") && r.includes("insurance"))) return " Agent-Insurance";
        if (r.includes("real estate") || r.includes("realtor")) return "Agent-Real Estate";
        if (r.includes("contractor connection")) return "Contractor Connection ";
        if (r.includes("contractor")) return "Contractor";
        if (r.includes("facility") || r.includes("building manager")) return "Facility or Building Manager";
        if (r.includes("homeowner") || r.includes("owner")) return "Homeowner";
        if (r.includes("hygienist")) return "Industrial Hygienist";
        if (r.includes("property manager")) return "Property Manager";
        if (r.includes("relative") || r.includes("friend") || r.includes("neighbor") || r.includes("spouse") || r.includes("parent") || r.includes("child")) return "Relative, Friend or Neighbor";
        if (r.includes("marketing") || r.includes("sales")) return "Sales Marketing Representative ";
        if (r.includes("servpro hq") || r.includes("hq")) return "SERVPRO HQ";
        if (r.includes("servpro franchise") || r.includes("franchise")) return "SERVPRO Franchise";
        if (r.includes("tenant") || r.includes("occupant")) return "Tenant";

        // No clean match: commercial -> Facility or Building Manager, residential -> Homeowner
        return isCommercial ? "Facility or Building Manager" : "Homeowner";
    }

    // Referred By for CreateJob - returns the combo's actual display text to search for
    function mapReferredByCreateJob(referredByRaw) {
        let refLower = (referredByRaw || "").toLowerCase().trim();
        if (!refLower) return null;
        if (refLower.includes("servpro.com") || refLower.includes("servpro,com")) return "servpro.com";
        if (refLower.includes("google")) return "google";
        if (refLower.includes("hq")) return "servpro hq";
        // Everything else -> no reliable contact match; leave blank / Other
        return null;
    }

    // --- TPA Company for CreateJob - derived from "How did you hear about SERVPRO?" ---
    // Option text as it appears in the TPA Company combo. If the live list spells one differently, change it here.
    const TPA_OPTIONS = { ALACRITY: "Alacrity", WESTHILL: "Westhill", HQ: "SERVPRO HQ", CC: "Contractor Connection" };
    // Exact item values captured from the live TPA Company combo (Oct 2026), used when the load-on-demand lookup
    // can't find the text - same idea as the Self-Pay 1171692 fallback for Insurance Carrier.
    const TPA_KNOWN_VALUES = {
        "Alacrity":              "2850880",
        "Westhill":              "2843891",
        "SERVPRO HQ":            "2843887",
        "Contractor Connection": "2843889"
    };

    // Tolerant of spacing, punctuation and typos: "ContractorConnections", "West Hill", "Servpro,com Call", "servpro hq", "Alacraty"
    function mapTPA(referredByRaw, hqRefRaw) {
        const text = cleanValue(referredByRaw).toLowerCase();
        const squash = text.replace(/[^a-z0-9]/g, "");          // "contractor connections" -> "contractorconnections"
        if (/alacr/.test(squash)) return TPA_OPTIONS.ALACRITY;
        if (/westhil/.test(squash)) return TPA_OPTIONS.WESTHILL;
        if (/contractorcon|contractercon|crawford/.test(squash)) return TPA_OPTIONS.CC;
        if (/servprocom|servprohq|headquarter|callcenter|priorityresponse|1800servpro|800servpro/.test(squash) || /\bhq\b|\bcorporate\b/.test(text)) return TPA_OPTIONS.HQ;
        // A SERVPRO HQ reference number on the key also means HQ sent the job
        const ref = cleanValue(hqRefRaw).toLowerCase();
        if (ref && !/^(no|n|none|false|0)$/.test(ref)) return TPA_OPTIONS.HQ;
        return null;
    }

    // Select the TPA Company by text, wait for the page to settle, and pin the known item value if the control
    // did not keep the selection. Runs from the CreateJob fill; also callable from the console:
    //   IntakeAutofillDebug.fillTPACompany("Contractor Connection")
    async function fillTPACompany(tpa) {
        if (!tpa) return false;
        const tpaEl = document.getElementById(CJ.TPACompany);
        if (!tpaEl) { console.log("✗ TPA Company combo not found on this page (#" + CJ.TPACompany + ")"); return false; }
        const shown = () => ((getCurrentDropdownValue(tpaEl) || {}).text || "").trim();
        const matches = () => shown().toLowerCase() === tpa.toLowerCase();

        let ok = await setLoadOnDemandCombo(CJ.TPACompany, tpa);
        await sleep(1200);                       // let any selected-index handler / AJAX refresh settle
        if (!matches()) {
            const known = TPA_KNOWN_VALUES[tpa];
            console.log(`↻ TPA Company shows "${shown()}" after lookup (lookup ok=${ok})` + (known ? ` - pinning known value ${known}` : " - no known value to pin"));
            if (known) {
                setDropdownValue(tpaEl, known, tpa, true);
                await sleep(800);
            }
        }
        ok = matches();
        console.log(ok ? `✓ TPA Company -> "${tpa}"` : `✗ TPA Company "${tpa}" could not be set (control shows "${shown()}")`);
        return ok;
    }

    // --- Referred By mapping (shared) ---
    function mapReferredBy(referredByRaw) {
        let referredBy = "Advertising - Other";
        let refLower = (referredByRaw || "").toLowerCase().trim();

        if (!refLower) return referredBy;

        if (refLower.includes("marketing rep")) {
            referredBy = "Advertising - Other";
        } else if (refLower.includes("hq") || refLower.includes("servpro hq")) {
            referredBy = "SERVPRO® Franchise Referral";
        } else if (/servpro[.,]com|google|chatgpt|\bbing\b|yahoo|duckduckgo|\bweb\s*site\b|website|\bsearch\b|\bonline\b|internet|\byelp\b|nextdoor|\bangi\b|facebook|\bgemini\b|copilot|\bsiri\b|\balexa\b/.test(refLower)) {
            referredBy = "Internet/Web Search";
        } else if (refLower.includes("insurance agent") || (refLower.includes("agent") && refLower.includes("ins"))) {
            referredBy = "Insurance Agent";
        } else if (refLower.includes("adjuster")) {
            referredBy = "Insurance Adjuster";
        } else if (/existing|repeat|previous|prior|past customer|returning|used (us|servpro) before|worked with/.test(refLower)) {
            referredBy = "Existing Relationship";
        } else {
            referredBy = "Advertising - Other";
        }
        return referredBy;
    }

    // ==========================================
    //  CREATEJOB.ASPX HELPER FUNCTIONS (Telerik RadComboBox)
    // ==========================================
    // Trigger the page's own ZIP->Country/State/County lookup
    function triggerZipBind(zipFieldId) {
        let el = document.getElementById(zipFieldId);
        if (!el) return;
        if (typeof el.onblur === 'function') {
            try { el.onblur(); } catch (e) {}
        } else {
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
    }

    function getCurrentDropdownValue(comboBoxElement) {
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) return null;
        try {
            const clientState = JSON.parse(hiddenField.value);
            return { value: clientState.value, text: clientState.text || inputEl.value };
        } catch (e) {
            return { value: '', text: inputEl.value };
        }
    }

    function isDropdownReady(comboBoxElement) {
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) return false;
        if (inputEl.disabled || inputEl.readOnly) return false;
        return comboBoxElement.offsetParent !== null;
    }

    function setDropdownValue(comboBoxElement, value, text, _forceUpdate = true, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300;
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) {
            if (retryCount < maxRetries) {
                setTimeout(() => setDropdownValue(comboBoxElement, value, text, _forceUpdate, retryCount + 1), retryDelay);
                return false;
            }
            return false;
        }
        if (!isDropdownReady(comboBoxElement) && retryCount < maxRetries) {
            setTimeout(() => setDropdownValue(comboBoxElement, value, text, _forceUpdate, retryCount + 1), retryDelay);
            return false;
        }
        const fieldId = inputEl.id || inputEl.name;
        inputEl.value = text;
        if (value === '' || text === 'Select') {
            hiddenField.value = JSON.stringify({ logEntries: [], value: '', text: '', enabled: true, checkedIndices: [], checkedItemsTextOverflows: false });
            inputEl.classList.add('rcbEmptyMessage');
        } else {
            hiddenField.value = JSON.stringify({ logEntries: [], value, text, enabled: true, checkedIndices: [], checkedItemsTextOverflows: false });
            inputEl.classList.remove('rcbEmptyMessage');
        }
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        hiddenField.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✓ Set ${fieldId} → ${text}`);
        return true;
    }

    // Find a RadComboBox client-side item by visible text (exact, then fuzzy)
    function findRadComboItemByText(comboBoxElement, text) {
        if (!window.$find || !text) return null;
        let combo = window.$find(comboBoxElement.id);
        if (!combo || !combo.get_items) return null;

        let target = text.toLowerCase().trim();
        let items = combo.get_items();
        let count = items.get_count();

        // exact match
        for (let i = 0; i < count; i++) {
            let item = items.getItem(i);
            let itemText = (item.get_text() || "").toLowerCase().trim();
            if (itemText === target) return item;
        }
        if (target.length <= 2) return null;   // never fuzzy-match 2-letter codes ("va" matches "Nevada")
        // fuzzy match (substring either direction)
        for (let i = 0; i < count; i++) {
            let item = items.getItem(i);
            let itemText = (item.get_text() || "").toLowerCase().trim();
            if (!itemText || itemText.includes("select")) continue;
            if (itemText.includes(target) || target.includes(itemText)) return item;
        }
        return null;
    }

    // Resolve text -> {value, text} via the Telerik client object, then write via setDropdownValue
    function setRadComboByText(comboBoxElement, text, forceUpdate = true) {
        if (!comboBoxElement || !text) return false;
        let item = findRadComboItemByText(comboBoxElement, text);
        if (item) {
            try { item.select(); } catch(e) {} // Forces validation state to acknowledge index change
            return setDropdownValue(comboBoxElement, item.get_value(), item.get_text(), forceUpdate);
        }
        console.log(`✗ No match found for "${text}" in #${comboBoxElement.id}`);
        return false;
    }

    // LOAD-ON-DEMAND combos (ReportedBy, ReferredBy, CustomCode, LossType, SecondaryLossType, Estimator, InsuranceCarrier):
    // their item list is EMPTY until the server is asked for items. Strategy:
    // 1. If items are already loaded, match directly.
    // 2. Otherwise call combo.requestItems(filterText) and match inside the itemsRequested event.
    // 3. If filtered request finds nothing, retry once with an empty filter (loads full list).
    function setLoadOnDemandCombo(clientId, text, useFilter = true) {
        return new Promise((resolve) => {
            if (!text) return resolve(false);
            let combo = window.$find ? window.$find(clientId) : null;
            let el = document.getElementById(clientId);
            if (!combo || !el) {
                console.log(`✗ Combo not found: #${clientId}`);
                return resolve(false);
            }

            let target = text.toLowerCase().trim();

            function matchLoadedItem() {
                let items = combo.get_items();
                let count = items.get_count();
                // exact first
                for (let i = 0; i < count; i++) {
                    let item = items.getItem(i);
                    let t = (item.get_text() || "").toLowerCase().trim();
                    if (t === target) return item;
                }
                // fuzzy
                for (let i = 0; i < count; i++) {
                    let item = items.getItem(i);
                    let t = (item.get_text() || "").toLowerCase().trim();
                    if (!t || t.includes("select")) continue;
                    if (t.includes(target) || target.includes(t)) return item;
                }
                return null;
            }

            function commit(item) {
                try { item.select(); } catch (e) { /* fall through to manual write */ }
                setDropdownValue(el, item.get_value(), item.get_text(), true);
                console.log(`✓ [LOD] #${clientId} -> "${item.get_text()}"`);
                resolve(true);
            }

            // Already loaded? Match immediately.
            if (combo.get_items().get_count() > 0) {
                let item = matchLoadedItem();
                if (item) return commit(item);
            }

            let attemptedFullLoad = false;

            let handler = function(sender, args) {
                let item = matchLoadedItem();
                if (item) {
                    combo.remove_itemsRequested(handler);
                    return commit(item);
                }
                if (!attemptedFullLoad) {
                    // Filtered request found nothing - load the full unfiltered list once
                    attemptedFullLoad = true;
                    setTimeout(() => { try { combo.requestItems("", false); } catch (e) {} }, 100);
                } else {
                    combo.remove_itemsRequested(handler);
                    console.log(`✗ [LOD] No match for "${text}" in #${clientId} after full load`);
                    resolve(false);
                }
            };
            combo.add_itemsRequested(handler);

            try {
                combo.requestItems(useFilter ? text : "", false);
            } catch (e) {
                combo.remove_itemsRequested(handler);
                console.log(`✗ [LOD] requestItems failed on #${clientId}:`, e.message);
                resolve(false);
            }

            // Safety: don't hang forever if the server never responds
            setTimeout(() => { combo.remove_itemsRequested(handler); resolve(false); }, 8000);
        });
    }

    function setRadTextBoxValue(clientId, text) {
        if (!text) return;
        let tb = window.$find && window.$find(clientId);
        if (tb && tb.set_value) {
            tb.set_value(text);
        }
        let inputEl = document.getElementById(clientId);
        if (inputEl) {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function setRadDate(clientId, jsDate) {
        if (!jsDate) return;
        let picker = window.$find && window.$find(clientId);
        if (picker && picker.set_selectedDate) {
            picker.set_selectedDate(jsDate);
        }
    }

    // Cause of Loss -> Source of Loss matcher. Tiers, most reliable first:
    //   1. a full option phrase found as whole words (longest first), upgraded to a longer option when the text
    //      also contains its extra words ("supply line under the sink" -> "Sink Supply Line")
    //   2. specific synonyms that the option list doesn't spell out ("burst pipe" -> Pipe Break)
    //   3. word coverage: >= 60% of an option's words present, at least one of them non-generic
    //   4. broad single-word synonyms ("tree", "roof", "window" ...)
    //   5. "Unknown" when the caller said so
    function matchSourceOfLoss(causeOfLossRaw, typeOfLossRaw) {
        const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const text = norm(causeOfLossRaw);
        const typeLower = (typeOfLossRaw || "").toLowerCase();

        // Duct cleaning jobs are the one place HVAC is a safe default
        if (typeLower.includes("duct")) return "HVAC";
        if (!text) return null;

        const stem = w => w.replace(/(ing|ed|es|s)$/, '');
        const skip = new Set(["other", "unknown"]);
        const stop = new Set(["the","a","an","of","from","to","and","in","on","it","is","was","has","been","yes","no","not","resolved","unknown"]);
        const generic = new Set(["water","leak","line","supply","drain","system","pipe","unit"]);
        const textWords = new Set(text.split(' ').filter(w => w && !stop.has(w)).map(stem));
        const optWordsOf = opt => norm(opt).split(' ').filter(Boolean).map(stem);
        // "toilet overflow" also matches "toilets overflowed" / "roof leaking"
        const wordRe = phrase => new RegExp('\\b' + norm(phrase).split(' ').map(w => escapeRe(w) + '(?:s|es|ed|ing)?').join('\\s+') + '\\b');

        // Best option by (coverage, non-generic hits, hits). mustContain = words the option must extend (phrase upgrade).
        const bestByCoverage = (minCoverage, mustContain) => {
            let best = null, bestKey = [0, 0, 0];
            for (let opt of sourceOfLossOptions) {
                if (skip.has(opt.toLowerCase())) continue;
                const optWords = optWordsOf(opt);
                const hits = optWords.filter(w => textWords.has(w));
                if (!hits.length || hits.every(w => generic.has(w))) continue;
                if (mustContain) {
                    if (!(optWords.length > mustContain.length && mustContain.every(w => optWords.includes(w)))) continue;
                    if (!hits.some(w => !mustContain.includes(w))) continue;        // must be supported by an EXTRA word from the text
                }
                const coverage = hits.length / optWords.length;
                if (coverage < minCoverage) continue;
                const key = [coverage, hits.filter(w => !generic.has(w)).length, hits.length];
                if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
                    best = opt; bestKey = key;
                }
            }
            return best;
        };

        // 1. Full option phrase (longest first)
        const byLength = [...sourceOfLossOptions].filter(o => !skip.has(o.toLowerCase())).sort((a, b) => b.length - a.length);
        for (let opt of byLength) {
            if (wordRe(opt).test(text)) return bestByCoverage(2 / 3, optWordsOf(opt)) || opt;
        }

        // 2. Specific synonyms (word-boundary, most specific first)
        const specificSynonyms = [
            [/\b(air\s*)?duct(work|s)?\b|\bduct cleaning\b/, "HVAC"],
            [/\bdryer vent\b/, "Dryer Vent"],
            [/\b(hvac|a\s?c|air conditioning|air conditioner)\b/, "HVAC"],
            [/\b(burst|broken|busted|cracked)\s+(water\s+)?pipe\b|\bpipe\s+(burst|broke|crack)/, "Pipe Break"],
            [/\bfrozen\s+pipe/, "Frozen Pipe Burst"],
            [/\bsewage\b|\bsewer\b|\bseptic\b/, "Sewer"],
            [/\bwasher\b/, "Washing Machine"],
            [/\bwater heater\b|\bhot water tank\b/, "Water Heater"],
            [/\bsump\b/, "Sump Pump Failure"],
            [/\bice\s?maker\b/, "Ice Maker Supply Line"],
            [/\bfridge\b/, "Refrigerator"],
            [/\bdisposal\b/, "Garbage Disposal"],
            [/\bwax ring\b/, "Toilet"],
            [/\bslab\b/, "Slab LeaK"],
            [/\bground\s?water\b|\bsurface water\b|\bseep(age|ing)?\b/, "Ground Surface Water"],
            [/\b(wind|storm)[\s-]*driven rain\b/, "Wind-Driven Rain"],
            [/\bice dam\b/, "Snow"],
            [/\b(kitchen|grease|cooking|stove|oven) fire\b|\bstove\b|\boven\b/, "Stove Oven"],
            [/\b(car|truck|vehicle|auto)\b.*\b(hit|struck|crash|impact|into)\b/, "Vehicle Impact"],
            [/\bwater main\b|\bmain line\b/, "Water Main"],
            [/\bback(ed)?\s?up\b/, "Drain Backup"]
        ];
        for (let [re, opt] of specificSynonyms) if (re.test(text)) return opt;

        // 3. Word coverage
        const covered = bestByCoverage(0.6, null);
        if (covered) return covered;

        // 4. Broad single-word synonyms
        const broadSynonyms = [
            [/\bbath\s?tub\b|\btub\b/, "Bath tub"],
            [/\bflood/, "Flood"],
            [/\bwind\b|\bwindy\b/, "Strong Winds"],
            [/\bsnow\b/, "Snow"],
            [/\btree\b/, "Tree"],
            [/\broof/, "Roof Leak"],
            [/\bwindow/, "Window Leak"],
            [/\bdoor/, "Door Leak"],
            [/\bclog/, "Clogged Drain"],
            [/\bhose\b/, "Hose Bib"],
            [/\belectric|\bwiring\b|\boutlet\b/, "Electrical"],
            [/\bsmok(e|ing)\b|\bcigar/, "Cigarette"],
            [/\bvandal/, "Vandalism"],
            [/\brain\b/, "Wind-Driven Rain"]
        ];
        for (let [re, opt] of broadSynonyms) if (re.test(text)) return opt;

        // 5. The caller said they don't know -> "Unknown" rather than "Other"
        if (/\bunknown\b|\bunsure\b|\bnot sure\b|\bdon'?t know\b|\bno idea\b|\bundetermined\b/.test(text)) return "Unknown";
        return null;
    }

    // ==========================================
    //  WORKCENTER CAUSE OF LOSS (cascades from Loss Type)
    //  Option lists dumped from ddCauseOfLoss on the live page (Oct 2026). Re-dump if WorkCenter changes them.
    // ==========================================
    const WC_CAUSE_OF_LOSS = {
        "Biohazard":        ["Death","Injury","Other","Sharps","Waste"],
        "Contents":         ["Biohazard","Fire","Mold","Other","Reconstruction","Sewage","Smoke","Water"],
        "Fire":             ["Candle","Dishwasher","Electrical Malfunction","Grease","Lightning","Other","Other Appliance","Puff Back-Furnace","Refrigerator","Stove/Oven","Unknown","Washing Machine","Wildfires"],
        "Fire/Water":       ["Candle","Dishwasher","Electrical Malfunction","Grease","Lightning","Other","Other Appliance","Puff Back-Furnace","Refrigerator","Stove/Oven","Unknown","Washing Machine","Wildfires"],
        "General Cleaning": ["Other","Pathogen/CSC"],
        "Liability":        ["AC Leak","Other","Other Appliance","Refrigerator","Stove/Oven","Washing Machine","Water Heater"],
        "Mold":             ["AC Leak","Flood","Hurricane","Ice Storm","Mildew","Other","Other Weather","Pipe","Roof Leak","Slab Leak","Sump Pump Failure","Toilet","Tornado","Unknown","Water Heater","Wind"],
        "Odor":             ["Animal","Electrical Malfunction","Grease","Mildew","Other","Sewage Back-up","Stain on Carpet","Unknown"],
        "Other":            ["Other"],
        "Reconstruction":   ["Biohazard","Fire","Mold","Other","Sewage","Smoke","Water"],
        "Roofing":          ["Fire","Hail","Impact","Snow/Ice","Vandalism","Wind"],
        "Sewage":           ["AC Leak","Flood","Hurricane","Ice Storm","Mildew","Other","Other Weather","Pipe","Roof Leak","Slab Leak","Sump Pump Failure","Toilet","Tornado","Tree Roots","Unknown","Water Heater","Wind"],
        "Smoke":            ["Candle","Dishwasher","Electrical Malfunction","Grease","Lightning","Other","Other Appliance","Puff Back-Furnace","Refrigerator","Stove/Oven","Unknown","Washing Machine","Wildfires"],
        "Tree Removal":     ["Other"],
        "Vandalism":        ["Other","Unknown"],
        "Water":            ["AC Leak","Flood","Hurricane","Ice Storm","Mildew","Other","Other Weather","Pipe","Roof Leak","Slab Leak","Sump Pump Failure","Toilet","Tornado","Unknown","Water Heater","Wind"]
    };

    // Synonyms for the WorkCenter options. ORDER = PRIORITY when several match within one list
    // ("water heater supply line" must hit Water Heater before Pipe; "roof leak after storm" Roof Leak before Other Weather).
    const WC_CAUSE_SYNONYMS = [
        ["Sump Pump Failure",      /\bsump\b/],
        ["Water Heater",           /\bwater heater\b|\bhot water (tank|heater)\b/],
        ["AC Leak",                /\bhvac\b|\ba\s?\/?\s?c\b|\bair condition|\bcondensat|\bdrain pan\b|\bmini[\s-]?split\b/],
        ["Slab Leak",              /\bslab\b/],
        ["Roof Leak",              /\broof/],
        ["Toilet",                 /\btoilet|\bwax ring\b|\bcommode\b/],
        ["Dishwasher",             /\bdishwasher\b/],
        ["Washing Machine",        /\bwashing machine\b|\bwasher\b|\blaundry\b/],
        ["Refrigerator",           /\bfridge\b|\brefrigerator\b|\bfreezer\b|\bice\s?maker\b/],
        ["Stove/Oven",             /\bstove\b|\boven\b|\brange\b|\bcooktop\b|\bburner\b|\bkitchen fire\b/],
        ["Grease",                 /\bgrease\b|\bcooking\b|\bfryer\b/],
        ["Candle",                 /\bcandle\b/],
        ["Puff Back-Furnace",      /\bpuff\s?back\b|\bfurnace\b|\bboiler\b|\boil burner\b/],
        ["Lightning",              /\blightning\b/],
        ["Wildfires",              /\bwild\s?fire|\bbrush fire\b|\bforest fire\b/],
        ["Electrical Malfunction", /\belectric|\bwiring\b|\boutlet\b|\bbreaker\b|\bshort(ed)?\b|\bextension cord\b|\bpower strip\b|\bpanel\b/],
        ["Other Appliance",        /\bdryer\b|\bmicrowave\b|\btoaster\b|\bspace heater\b|\bappliance\b|\bheater\b|\bdehumidifier\b|\bhumidifier\b/],
        ["Tree Roots",             /\btree root|\broots?\b/],
        ["Sewage Back-up",         /\bsewage\b|\bsewer\b|\bseptic\b/],
        ["Sewage",                 /\bsewage\b|\bsewer\b|\bseptic\b/],
        ["Flood",                  /\bflood/],
        ["Hurricane",              /\bhurricane\b|\btropical storm\b/],
        ["Tornado",                /\btornado\b/],
        ["Ice Storm",              /\bice storm\b|\bice dam\b|\bice\b(?!\s?maker)/],
        ["Snow/Ice",               /\bsnow\b|\bice\b|\bfreez/],
        ["Hail",                   /\bhail\b/],
        ["Wind",                   /\bwind\b|\bwindy\b|\bgust/],
        ["Impact",                 /\bimpact\b|\btree\b|\bfell\b|\bfall(en|ing)?\b|\bhit\b|\bstruck\b|\bdebris\b|\bvehicle\b|\bcar\b/],
        ["Vandalism",              /\bvandal|\bbreak[\s-]?in\b|\bburglar/],
        ["Mildew",                 /\bmildew\b|\bmusty\b/],
        ["Animal",                 /\banimal\b|\bpet\b|\bdog\b|\bcat\b|\brodent\b|\bmouse\b|\bmice\b|\brats?\b|\braccoon\b|\bskunk\b|\burine\b|\bdead\b/],
        ["Stain on Carpet",        /\bstain|\bcarpet\b/],
        ["Death",                  /\bdeath\b|\bdeceased\b|\bpassed away\b|\bbody\b|\bdecomp|\bsuicide\b|\bhomicide\b|\bunattended\b/],
        ["Sharps",                 /\bsharps?\b|\bneedle|\bsyringe/],
        ["Injury",                 /\binjur|\bblood\b|\baccident\b|\btrauma\b|\bcrime scene\b/],
        ["Waste",                  /\bwaste\b|\bfeces\b|\bhoard|\bbio\s?hazard\b/],
        ["Pathogen/CSC",           /\bpathogen|\bcovid\b|\bvirus|\bdisinfect|\bsanitiz|\bcsc\b/],
        ["Biohazard",              /\bbio\s?hazard\b|\btrauma\b/],
        ["Fire",                   /\bfire\b/],
        ["Smoke",                  /\bsmoke\b|\bsoot\b/],
        ["Mold",                   /\bmold\b/],
        ["Water",                  /\bwater\b|\bleak|\bpipe|\bflood|\bburst\b/],
        ["Pipe",                   /\bpipe|\bsupply line\b|\bwater line\b|\bplumbing\b|\bburst\b|\bvalve\b|\bfitting\b|\bhose\b|\bline\b|\bdrain\b|\bleak|\bfrozen\b|\bback(ed)?[\s-]?up\b|\bclog|\bsewer\b/],
        ["Other Weather",          /\bstorm\b|\brain\b|\bweather\b|\bsnow\b|\bhail\b|\blightning\b/],
        ["Unknown",                /\bunknown\b|\bunsure\b|\bnot sure\b|\bdon'?t know\b|\bno idea\b|\bundetermined\b|\btbd\b/]
    ];

    // Which WC_CAUSE_OF_LOSS list applies to a Loss Type text ("Water", "Water Damage", "Fire/Smoke", "Storm"...)
    function wcCauseListFor(lossTypeText) {
        const t = (lossTypeText || "").toLowerCase().trim();
        if (!t) return null;
        const keys = Object.keys(WC_CAUSE_OF_LOSS);
        let key = keys.find(k => k.toLowerCase() === t)
               || keys.slice().sort((a, b) => b.length - a.length).find(k => new RegExp('\\b' + escapeRe(k.toLowerCase()) + '\\b').test(t));
        if (!key && /\bstorm\b|\bflood\b/.test(t)) key = "Water";
        if (!key && /\bbio\b/.test(t)) key = "Biohazard";
        return key ? { key, options: WC_CAUSE_OF_LOSS[key] } : null;
    }

    // Cause of Loss text -> the WorkCenter option valid for this Loss Type, or null (caller falls back to "Other")
    function matchWorkCenterCauseOfLoss(causeOfLossRaw, lossTypeText) {
        const list = wcCauseListFor(lossTypeText);
        if (!list) return null;
        const text = (causeOfLossRaw || "").toLowerCase().replace(/[^a-z0-9\s\/'-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        const has = o => list.options.some(x => x.toLowerCase() === o.toLowerCase());

        // 1. The option's own wording appears in the text ("sump pump failure", "slab leak", "stove/oven")
        for (const opt of list.options.slice().sort((a, b) => b.length - a.length)) {
            if (/^(other|unknown)$/i.test(opt)) continue;
            const re = new RegExp('\\b' + opt.toLowerCase().split(/[\s\/-]+/).map(escapeRe).join('[\\s\\/-]+') + '(?:s|es|ed|ing)?\\b');
            if (re.test(text)) return opt;
        }
        // 2. Synonyms, in priority order, restricted to the options this Loss Type offers
        for (const [opt, re] of WC_CAUSE_SYNONYMS) {
            if (has(opt) && re.test(text)) return opt;
        }
        return null;
    }

    // Wait for a cascading Kendo dropdown to list `text` (its options reload after the parent dropdown changes), then select it
    async function setKendoDropdownWhenLoaded(elementId, text, timeout = 5000) {
        if (!window.jQuery || !text) return false;
        const target = String(text).toLowerCase().trim();
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = window.jQuery('#' + elementId);
            const widget = el.data('kendoDropDownList') || el.data('kendoComboBox');
            if (widget && widget.dataSource) {
                const tField = widget.options.dataTextField;
                const texts = widget.dataSource.data().map(d => typeof d === 'string' ? d
                    : String((tField && d[tField]) || d.Name || d.name || d.Text || d.text || d.Description || '')).map(s => s.toLowerCase().trim());
                if (texts.includes(target)) return setKendoDropdownExact(elementId, text);
            }
            await sleep(250);
        }
        console.log(`✗ #${elementId} never listed "${text}" within ${timeout}ms`);
        return false;
    }

    // ==========================================
    //  WORKCENTER (intake) AUTOFILL
    // ==========================================
    function autofillWorkCenter(data) {
        const callerName = data[COLUMN.CallerName] || "";
        const callerParts = splitName(callerName);
        const propertyType = data[COLUMN.PropertyType] || "";
        const bizName = data[COLUMN.BusinessName] || "";
        const phoneDigits = extractPhone(data[COLUMN.Phone]) || extractPhone(data[COLUMN.AdditionalPhone]);
        const phone = formatPhoneParens(phoneDigits);
        const email = extractEmail(data[COLUMN.Email_Field]) || extractEmail(data[COLUMN.SecondaryEmail]);
        const typeOfLoss = data[COLUMN.TypeOfLoss] || "";
        const dateOfLossRaw = data[COLUMN.DateOfLoss] || "";
        const causeOfLoss = data[COLUMN.CauseOfLoss] || "";
        const reportedByRaw = data[COLUMN.ReportedBy] || "";
        const referredByRaw = data[COLUMN.ReferredBy] || "";
        const selfPayOrIns = data[COLUMN.SelfPayOrIns] || "";
        const claimNum = data[COLUMN.ClaimNum] || "";
        const insuranceCarrier = data[COLUMN.InsuranceCarrier] || "";
        let scheduledPMRaw = data[COLUMN.ScheduledPM] || "";
        const scheduledPM = scheduledPMRaw.trim() === "" ? "**NOT ASSIGNED**" : scheduledPMRaw;
        const arrivalDateRaw = data[COLUMN.ArrivalDate] || "";

        // Loss / Billing resolved the same way on both pages ("same as ..." in either field, blank billing = same as loss).
        // billingSameAsLossAddress drives the "Same as Caller" (Customer) -> "Same as Customer" (Loss Address) sequence below.
        const addresses = resolveAddressPair(data[COLUMN.LossAddress], data[COLUMN.BillingAddress]);
        const lossAddressRaw = addresses.loss;
        const billingAddressRaw = addresses.billing;
        const billingSameAsLossAddress = addresses.billingSameAsLoss;



        let reportedBy = mapReportedBy(reportedByRaw);
        // Commercial: if no clean match, default to Facility Manager rather than Other
        if (propertyType.toLowerCase().includes('com') && reportedBy === "Other") {
            reportedBy = "Facility Manager";
        }
        const referredBy = mapReferredBy(referredByRaw);

        console.log("=== WC DEBUG INFO ===");
        console.log("callerName:", callerName, "->", callerParts, "phone:", phone, "email:", email, "selfPayOrIns:", selfPayOrIns, "scheduledPM:", scheduledPM);
        console.log("addresses:", addresses);
        console.log("referredByRaw:", referredByRaw, "-> referredBy:", referredBy);
        console.log("reportedByRaw:", reportedByRaw, "-> reportedBy:", reportedBy);

        // --- Execution Step 1: Push Primary Forms Fields ---
        if (propertyType.toLowerCase().includes('res')) document.getElementById('radio1')?.click();
        if (propertyType.toLowerCase().includes('com')) document.getElementById('radio2')?.click();
        if (selfPayOrIns.toLowerCase().includes('self')) document.getElementById('selfpay')?.click();

        if (referredByRaw.toLowerCase().includes("servpro.com") || referredByRaw.toLowerCase().includes("servpro,com")) {
            document.getElementById('rdCallSourceServproCall')?.click();
        } else {
            document.getElementById('rdCallSourceOther')?.click();
        }

        // --- Execution Step 2: Main Form Populating ---
        setTimeout(() => {
            let prefix = propertyType ? propertyType.substring(0,3).toUpperCase() : "";
            let customNote = prefix && typeOfLoss ? `${prefix}/${typeOfLoss}` : (prefix || typeOfLoss || "");
            setJournalNote(customNote);

            let parsedAddress = parseAddress(lossAddressRaw);
            console.log("WC parsed loss address:", parsedAddress);

            // Address block runs on its own so the zip-lookup wait doesn't delay the rest of this step
            (async () => {
                setKOValue('#customerAddress1', parsedAddress.street);
                setKOValue('#callerPostalCode', parsedAddress.zip, true);
                await sleep(700);   // let any zip-triggered lookup finish before city/state
                setKOValue('#callerCity', parsedAddress.city, true);
                setKendoDropdownExact('callerState', stateCandidates(parsedAddress.state));
            })();

            // Franchise no longer depends on BOTH street and city parsing successfully
            if (parsedAddress.zip || parsedAddress.city) {
                let franchiseKey = resolveFranchise(parsedAddress.zip, parsedAddress.city, data[COLUMN.EnvironmentalCode]);
                if (franchiseKey) {
                    let translatedFranchiseName = franchiseNameTranslation[franchiseKey] || franchiseKey;
                    setKendoDropdownExact('FranchiseDD', translatedFranchiseName);
                }
            }

            setKendoDropdownExact('ddlLostType2', typeOfLoss);
            setKendoDropdownExact('ddReportedBy', reportedBy);
            setKendoDropdownExact('ddReferredBy', referredBy);

            if (insuranceCarrier && !selfPayOrIns.toLowerCase().includes('self')) {
                 setKendoDropdownExact('ddlInsuranceCarrier', insuranceCarrier);
            }

            if (window.jQuery) {
                let lossDateJS = parseDataDate(dateOfLossRaw);
                let dolPicker = window.jQuery("input[data-bind*='DateOfLoss']").data("kendoDateTimePicker");
                if (dolPicker && lossDateJS) { dolPicker.value(lossDateJS); dolPicker.trigger("change"); }
            }
        }, 800);

        // --- Execution Step 3: Loss Characteristics & Site Appointment ---
        setTimeout(() => {
            let baseArrivalDate = parseDataDate(arrivalDateRaw);
            if (baseArrivalDate) {
                let beginDate = new Date(baseArrivalDate); beginDate.setHours(0, 0, 0, 0);
                let endDate = new Date(baseArrivalDate); endDate.setHours(0, 0, 0, 0);

                let beginPicker = window.jQuery("input[data-bind*='SiteAppointmentBegin']").data("kendoDateTimePicker");
                if (beginPicker) { beginPicker.value(beginDate); beginPicker.trigger("change"); }

                let endPicker = window.jQuery("input[data-bind*='SiteAppointmentEnd']").data("kendoDateTimePicker");
                if (endPicker) { endPicker.value(endDate); endPicker.trigger("change"); }
            }

            setKendoDropdownExact('ddlLostType2', typeOfLoss);
            setKendoDropdownExact('byDD', scheduledPM);

            // Cause of Loss cascades from Loss Type: match against the list for the Loss Type that is actually
            // selected, and only commit once the dropdown has reloaded with that list.
            (async () => {
                const ltEl = window.jQuery('#ddlLostType2');
                const ltWidget = ltEl.data('kendoDropDownList') || ltEl.data('kendoComboBox');
                let selectedLossType = (ltWidget && typeof ltWidget.text === 'function') ? (ltWidget.text() || "") : "";
                if (!selectedLossType || /select/i.test(selectedLossType)) selectedLossType = typeOfLoss;
                const wcCause = matchWorkCenterCauseOfLoss(causeOfLoss, selectedLossType) || 'Other';
                console.log("WC Cause of Loss:", causeOfLoss, "| Loss Type:", selectedLossType, "->", wcCause);
                const ok = await setKendoDropdownWhenLoaded('ddCauseOfLoss', wcCause, 5000);
                if (!ok && wcCause !== 'Other') setKendoDropdownExact('ddCauseOfLoss', 'Other');
            })();
        }, 2200);

        // --- Execution Step 4: Insurance Details & Claim Number ---
        setTimeout(() => {
            if (!selfPayOrIns.toLowerCase().includes('self') && insuranceCarrier) {
                setKendoDropdownExact('ddlInsuranceCarrier', insuranceCarrier);
            }
            if (claimNum) {
                let claimInput = document.getElementById('txtClaimNumber');
                if (claimInput) {
                    claimInput.value = claimNum;
                    window.jQuery(claimInput).val(claimNum).trigger('input').trigger('change');
                }
            }
        }, 2800);

        // --- Execution Step 5: Priority Responder & Project Manager ---
        setTimeout(() => {
            let attempts = 0;
            let pmInterval = setInterval(() => {
                let pRes = window.jQuery('#priorityResponderDD').data("kendoDropDownList");
                let pMan = window.jQuery('#projectManagerDD').data("kendoDropDownList");

                if (pRes && pMan && pRes.dataSource.data().length > 0) {
                    setKendoDropdownExact('priorityResponderDD', scheduledPM);
                    setKendoDropdownExact('projectManagerDD', scheduledPM);
                    clearInterval(pmInterval);
                } else {
                    setKendoDropdownExact('priorityResponderDD', scheduledPM);
                    setKendoDropdownExact('projectManagerDD', scheduledPM);
                }

                attempts++;
                if (attempts > 10) clearInterval(pmInterval); // Stop after 5 seconds
            }, 500);
        }, 3200);

        // --- Execution Step 6: Force Open Add Caller Modal ---
        setTimeout(() => {
            let callerInput = document.getElementById("autoCompleteCallerContact");
            if (callerInput) {
                callerInput.value = callerParts.full || callerName;
                callerInput.dispatchEvent(new Event("input", { bubbles: true }));
                callerInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
            setTimeout(() => {
                let addBtn = window.jQuery("button[title*='Add'], button:has(i:contains('add')), button:has(i:contains('person_add'))").not(":disabled").first();
                if (addBtn.length) addBtn.click();
            }, 600);
        }, 2500);

        // ==========================================
        //  POPUP INTERACTION AUTOMATION WATCHERS
        // ==========================================

        // Watcher A: Undispositioned Calls Matching Engine
        let callDialogInterval = setInterval(() => {
            let dialog = window.jQuery("#callSourceDialog");
            if (dialog.length && dialog.is(":visible")) {
                clearInterval(callDialogInterval);
                let cleanTargetPhone = phoneDigits;
                let matched = false;

                let rows = dialog.find("table tbody tr");
                rows.each(function() {
                    let rowPhoneText = window.jQuery(this).text() || "";
                    let cleanRowPhone = rowPhoneText.replace(/\D/g, '');
                    if (cleanRowPhone && cleanTargetPhone && cleanRowPhone.includes(cleanTargetPhone)) {
                        let radioBtn = window.jQuery(this).find("input[type='radio'][name='selectedCall']");
                        radioBtn.click();
                        radioBtn.prop('checked', true);
                        matched = true;
                    }
                });

                if (matched) {
                    setTimeout(() => { dialog.find("button.btn-success").click(); }, 300);
                } else {
                    setTimeout(() => {
                        dialog.find("button.btn-danger").click();
                        setTimeout(() => {
                            let otherCallRadio = document.getElementById('rdCallSourceOther');
                            if (otherCallRadio) {
                                otherCallRadio.click();
                                otherCallRadio.checked = true;
                                window.jQuery(otherCallRadio).trigger('change');
                            }
                            setKendoDropdownExact('ddReferredBy', referredBy);
                        }, 500);
                    }, 300);
                }
            }
        }, 300);
        setTimeout(() => clearInterval(callDialogInterval), 15000);

        // Watcher B: Add/Edit Contact Modal Injector - Auto Fill & Save
        let contactDialogInterval = setInterval(() => {
            let dialogNode = document.getElementById("addEditContactDialog");
            if (dialogNode && window.jQuery(dialogNode).is(":visible")) {
                clearInterval(contactDialogInterval);

                let formattedPhone = phone;                 // already "(804) 555-1234" or ""
                let contactAddressRaw = billingAddressRaw;  // resolveAddressPair already substituted the loss address when billing was blank / "same as loss"

                setTimeout(() => {
                    // Same First / Last split as CreateJob (last word = last name; prefixes, suffixes and "(role)" stripped)
                    let firstNameEl = document.getElementById('txtFirstName');
                    if (firstNameEl) {
                        firstNameEl.value = callerParts.first;
                        let koData = window.ko.dataFor(firstNameEl);
                        if (koData && typeof koData.FirstName === 'function') koData.FirstName(callerParts.first);
                        window.jQuery(firstNameEl).trigger('input').trigger('change');
                    }

                    let lastNameEl = document.getElementById('txtLastName');
                    if (lastNameEl) {
                        lastNameEl.value = callerParts.last;
                        let koData = window.ko.dataFor(lastNameEl);
                        if (koData && typeof koData.LastName === 'function') koData.LastName(callerParts.last);
                        window.jQuery(lastNameEl).trigger('input').trigger('change');
                    }

                    let businessEl = document.getElementById('contact-business');
                    if (businessEl && bizName) {
                        businessEl.value = bizName;
                        window.jQuery(businessEl).trigger('input').trigger('change');
                    }

                    setKendoDropdownExact('titleDD', reportedBy);

                    let parsedAddress = parseAddress(contactAddressRaw);

                    let addr1 = document.getElementById('lossAddress1');
                    if (addr1 && parsedAddress.street) {
                        addr1.value = parsedAddress.street;
                        let koData = window.ko.dataFor(addr1);
                        if (koData && typeof koData.Address1 === 'function') koData.Address1(parsedAddress.street);
                        window.jQuery(addr1).val(parsedAddress.street).trigger('input').trigger('change');
                    }

                    let cityEl = document.getElementById('lossCity');
                    if (cityEl && parsedAddress.city) {
                        cityEl.value = parsedAddress.city;
                        let koData = window.ko.dataFor(cityEl);
                        if (koData && typeof koData.City === 'function') koData.City(parsedAddress.city);
                        window.jQuery(cityEl).trigger('input').trigger('change');
                    }

                    let zipEl = document.getElementById('contactAddEditPostalCode');
                    if (zipEl && parsedAddress.zip) {
                        zipEl.value = parsedAddress.zip;
                        let koData = window.ko.dataFor(zipEl);
                        if (koData && typeof koData.PostalCode === 'function') koData.PostalCode(parsedAddress.zip);
                        window.jQuery(zipEl).trigger('input').trigger('change');
                    }

                    if (parsedAddress.state) setKendoDropdownExact('contactStateDD', stateCandidates(parsedAddress.state));

                    let addr2 = document.getElementById('lossAddress2');
                    if (addr2) {
                        addr2.value = '';
                        let koData = window.ko.dataFor(addr2);
                        if (koData && typeof koData.Address2 === 'function') koData.Address2('');
                        window.jQuery(addr2).trigger('input').trigger('change');
                    }
                }, 200);

                setTimeout(() => {
                    let phoneInputs = document.querySelectorAll("#divPhone input[type='text'][placeholder='Phone Number']");
                    if (phoneInputs.length > 1) {
                        for (let i = phoneInputs.length - 1; i >= 0; i--) {
                            let phoneValue = phoneInputs[i].value.trim();
                            if (phoneValue === '' || !phoneValue) {
                                let phoneRow = phoneInputs[i].closest('.row');
                                let deleteBtn = phoneRow.querySelector("span[data-bind*='deletePhone']");
                                if (deleteBtn && deleteBtn.offsetParent !== null) deleteBtn.click();
                            }
                        }
                    }
                }, 300);

                setTimeout(() => {
                    if (formattedPhone && formattedPhone.trim() !== "") {
                        let phoneInputs = document.querySelectorAll("#divPhone input[type='text'][placeholder='Phone Number']");
                        if (phoneInputs.length > 0) {
                            let phoneInput = phoneInputs[0];
                            phoneInput.value = formattedPhone;
                            let koData = window.ko.dataFor(phoneInput);
                            if (koData && typeof koData.Number === 'function') koData.Number(formattedPhone);
                            window.jQuery(phoneInput).val(formattedPhone).trigger('input').trigger('change');
                        }
                    }
                }, 350);

                setTimeout(() => {
                    if (email) {
                        let emailInputs = document.querySelectorAll("#divConnections input[type='text']");
                        if (emailInputs.length > 0) {
                            let emailInput = emailInputs[0];
                            emailInput.value = email;
                            let koData = window.ko.dataFor(emailInput);
                            if (koData && typeof koData.ConnectionText === 'function') koData.ConnectionText(email);
                            window.jQuery(emailInput).val(email).trigger('input').trigger('change');
                        }
                    }
                }, 400);

                setTimeout(() => {
                    let saveBtn = document.getElementById('btnSaveContact');
                    if (saveBtn && !saveBtn.disabled) saveBtn.click();
                }, 600);
            }
        }, 300);
        setTimeout(() => clearInterval(contactDialogInterval), 25000);

        // Watcher C: "Same as Caller" -> "Same as Customer" Auto-Kicker
        // Only runs when Billing Address indicates it matches the Loss Address.
        // Sequence MUST be: wait for Caller to be fully saved -> click "Same as Caller" (Customer)
        // -> then click "Same as Customer" (Loss Address).
        if (billingSameAsLossAddress) {
            // Delay the start of this watcher by 5 seconds to ensure the Caller modal has been completely processed and closed.
            setTimeout(() => {
                let sameAsCallerInterval = setInterval(() => {
                    let contactDialog = document.getElementById("addEditContactDialog");
                    let callerInput = document.getElementById("autoCompleteCallerContact");

                    let isModalOpen = contactDialog && window.jQuery(contactDialog).is(":visible");
                    let isCallerFilled = callerInput && callerInput.value.trim() !== "";

                    if (!isModalOpen && isCallerFilled) {
                        // Precise selector: Customer's "Same as Caller" data-bind ENDS WITH "sameAsCallerClick".
                        // Occupant's ends with "sameAsCallerClickOccupant" and will NOT match $=.
                        let sameAsCallerBtn = document.querySelector("button[data-bind$='sameAsCallerClick']");
                        if (sameAsCallerBtn && sameAsCallerBtn.offsetParent !== null) {
                            let koContext = window.ko && window.ko.contextFor ? window.ko.contextFor(sameAsCallerBtn) : null;
                            if (koContext && koContext.$parent && typeof koContext.$parent.sameAsCallerClick === 'function') {
                                koContext.$parent.sameAsCallerClick();
                            } else {
                                sameAsCallerBtn.click();
                            }
                            console.log("✓ Clicked 'Same as Caller' (Customer)");
                            clearInterval(sameAsCallerInterval);

                            // Chase "Same as Customer" under Loss Address once Customer has settled.
                            setTimeout(() => {
                                let sameAsCustomerLossInterval = setInterval(() => {
                                    let sameAsCustomerLossBtn = document.querySelector("button[data-bind*='sameAsCustomerClickLossAddress']");
                                    if (sameAsCustomerLossBtn && sameAsCustomerLossBtn.offsetParent !== null) {
                                        let lossKoContext = window.ko && window.ko.contextFor ? window.ko.contextFor(sameAsCustomerLossBtn) : null;
                                        if (lossKoContext && lossKoContext.$parent && typeof lossKoContext.$parent.sameAsCustomerClickLossAddress === 'function') {
                                            lossKoContext.$parent.sameAsCustomerClickLossAddress();
                                        } else {
                                            sameAsCustomerLossBtn.click();
                                        }
                                        console.log("✓ Clicked 'Same as Customer' (Loss Address)");
                                        clearInterval(sameAsCustomerLossInterval);
                                    }
                                }, 500);
                                setTimeout(() => clearInterval(sameAsCustomerLossInterval), 10000);
                            }, 800);
                        }
                    }
                }, 500);

                setTimeout(() => clearInterval(sameAsCallerInterval), 20000);
            }, 5000);
        }
    }

    // ==========================================
    //  CREATEJOB.ASPX AUTOFILL
    // ==========================================
    async function autofillCreateJob(data) {
        const callerName = data[COLUMN.CallerName] || "";
        const callerParts = splitName(callerName);
        const phone = extractPhone(data[COLUMN.Phone]) || extractPhone(data[COLUMN.AdditionalPhone]);   // 10 digits or ""
        const email = extractEmail(data[COLUMN.Email_Field]) || extractEmail(data[COLUMN.SecondaryEmail]);
        const propertyType = data[COLUMN.PropertyType] || "";
        const addresses = resolveAddressPair(data[COLUMN.LossAddress], data[COLUMN.BillingAddress]);
        const lossAddressRaw = addresses.loss;
        const billingAddressRaw = addresses.billing;
        const typeOfLoss = data[COLUMN.TypeOfLoss] || "";
        const dateOfLossRaw = data[COLUMN.DateOfLoss] || "";
        const causeOfLoss = data[COLUMN.CauseOfLoss] || "";
        const reportedByRaw = data[COLUMN.ReportedBy] || "";
        const referredByRaw = data[COLUMN.ReferredBy] || "";
        const selfPayOrIns = data[COLUMN.SelfPayOrIns] || "";
        const insuranceCarrier = data[COLUMN.InsuranceCarrier] || "";
        const claimNum = data[COLUMN.ClaimNum] || "";
        const policyNum = data[COLUMN.PolicyNum] || "";
        let scheduledPMRaw = data[COLUMN.ScheduledPM] || "";
        const scheduledPM = scheduledPMRaw.trim() === "" ? "**NOT ASSIGNED**" : scheduledPMRaw;

        const isSelfPay = selfPayOrIns.toLowerCase().includes('self');

        // ---- Customer Information (billing) + Job Address (loss) ----
        // POC name split (shared with WorkCenter): last word = last name, prefixes / suffixes / "(role)" stripped
        let custFirst = callerParts.first;
        let custLast  = callerParts.last;

        let lossParsed = parseAddress(lossAddressRaw);
        let billingSame = addresses.billingSameAsLoss;

        // Customer (= billing). If billing is "same as loss" (or blank), Customer gets the loss address.
        let custAddr = billingSame ? lossParsed : parseAddress(billingAddressRaw);
        console.log("CJ addresses:", addresses, "loss parsed:", lossParsed, "billing parsed:", custAddr);

        let isCommercial = propertyType.toLowerCase().includes('com');
        let bizName = data[COLUMN.BusinessName] || "";

        if (isCommercial) {
            // Ensure Company Customer mode is active
            let companyRadio = document.getElementById("ctl00_ContentPlaceHolder1_JobParentInformation_RadioButton_CompanyCustomer");
            if (companyRadio && !companyRadio.checked) {
                companyRadio.click();
                await new Promise(r => setTimeout(r, 800));
            }

            // Best-effort: link an existing company customer by billing address
            try {
                let custMatch = await findCompanyCustomerByAddress(custAddr);
                if (custMatch) {
                    let boxEl = document.getElementById(CJ.CompanyCustomerSearch);
                    if (boxEl) {
                        setDropdownValue(boxEl, custMatch.Value, custMatch.Text, true);
                        console.log(`✓ Existing company customer matched -> "${custMatch.Text}"`);
                    }
                } else {
                    console.log("Company customer search: no address match - filling manually");
                }
            } catch (e) {
                console.log("Company customer search failed:", e.message);
            }

            // ---- Customer As Company Information (= billing) ----
            setPlainTextBox(CJ.CompanyName,  bizName);
            setPlainTextBox(CJ.CompanyEmail, email);
            setMaskedPhone(CJ.CompanyMainPhone, phone);
            if (custAddr.street) setSearchBoxAddress(CJ.CompanyAddress, custAddr.street);
            await fillZipCityState({ zip: CJ.CompanyZip, city: CJ.CompanyCity, state: CJ.CompanyState }, custAddr);

            // Contact Person under Customer As Company (POC)
            setPlainTextBox(CJ.CCFirstName, custFirst);
            setPlainTextBox(CJ.CCLastName,  custLast);
            setMaskedPhone(CJ.CCMainPhone,  phone);
            if (email) setPlainTextBox(CJ.ContactEmail, email);

            // ---- Company Job Address Information (= loss); POC name goes HERE only ----
            if (billingSame) {
                await new Promise(r => setTimeout(r, 1000));
                let sameChk = document.getElementById(CJ.CompanyJobSameAddr);
                if (sameChk && !sameChk.checked) {
                    sameChk.click();
                    console.log("✓ Checked 'Same as Customer Company Address'");
                }
                await new Promise(r => setTimeout(r, 500));
                triggerZipBind(CJ.CompanyZipLoss);
                setPlainTextBox(CJ.CompanyLossFirstName, custFirst);
                setPlainTextBox(CJ.CompanyLossLastName,  custLast);
            } else {
                setPlainTextBox(CJ.CompanyLossFirstName, custFirst);
                setPlainTextBox(CJ.CompanyLossLastName,  custLast);
                setMaskedPhone(CJ.CompanyMainPhoneLoss, phone);
                if (lossParsed.street) setSearchBoxAddress(CJ.CompanyAddressLoss, lossParsed.street);
                await fillZipCityState({ zip: CJ.CompanyZipLoss, city: CJ.CompanyCityLoss, state: CJ.CompanyStateLoss }, lossParsed);
            }
        } else {
            // ---- RESIDENTIAL: individual customer fill ----
            setPlainTextBox(CJ.CustFirstName, custFirst);
            setPlainTextBox(CJ.CustLastName,  custLast);
            setPlainTextBox(CJ.CustEmail,     email);
            setMaskedPhone(CJ.CustMainPhone,  phone);
            if (custAddr.street) setSearchBoxAddress(CJ.CustAddress, custAddr.street);
            await fillZipCityState({ zip: CJ.CustZip, city: CJ.CustCity, state: CJ.CustState }, custAddr);

            if (billingSame) {
                await new Promise(r => setTimeout(r, 1000));
                let sameChk = document.getElementById(CJ.SameAsCustomer);
                if (sameChk && !sameChk.checked) {
                    sameChk.click();
                    console.log("✓ Checked 'Same as Customer Address' (after 1s delay)");
                }
                await new Promise(r => setTimeout(r, 500));
                triggerZipBind(CJ.LossZip);
            } else {
                setPlainTextBox(CJ.LossFirstName, custFirst);
                setPlainTextBox(CJ.LossLastName,  custLast);
                setMaskedPhone(CJ.LossMainPhone,  phone);
                if (lossParsed.street) setSearchBoxAddress(CJ.LossAddress, lossParsed.street);
                await fillZipCityState({ zip: CJ.LossZip, city: CJ.LossCity, state: CJ.LossState }, lossParsed);
            }
        }

        console.log("=== CreateJob DEBUG INFO ===");
        console.log("callerName (Job Name):", callerName, "->", callerParts, "phone:", phone, "email:", email);
        console.log("reportedByRaw:", reportedByRaw, "referredByRaw:", referredByRaw);
        console.log("typeOfLoss:", typeOfLoss, "causeOfLoss:", causeOfLoss);
        console.log("isSelfPay:", isSelfPay, "carrier:", insuranceCarrier, "claim#:", claimNum, "policy#:", policyNum);
        console.log("scheduledPM (Estimator):", scheduledPM);

        // 1. Job Name = Company name (commercial) or POC name (residential)
        let jobName = isCommercial ? (bizName || callerName) : callerName;
        setRadTextBoxValue(CJ.JobName, jobName);

        // 2. Loss Category (Residential / Commercial) - preloaded combo
        let lossCategory = "";
        if (propertyType.toLowerCase().includes('com')) lossCategory = "Commercial";
        else if (propertyType.toLowerCase().includes('res')) lossCategory = "Residential";

        let lossCategoryEl = document.getElementById(CJ.LossCategory);
        if (lossCategoryEl && lossCategory) setRadComboByText(lossCategoryEl, lossCategory, true);

        // 3. Date of Loss (Excel serial or a date string)
        let lossDateJS = parseDataDate(dateOfLossRaw);
        if (lossDateJS) setRadDate(CJ.DateOfLoss, lossDateJS);
        else if (dateOfLossRaw) console.log(`⚠ Could not parse Date of Loss "${dateOfLossRaw}"`);

// 4. Reported By / Referred By - LOAD ON DEMAND combos
        let reportedByCJ = mapReportedByCreateJob(reportedByRaw, isCommercial);
        await setLoadOnDemandCombo(CJ.ReportedBy, reportedByCJ);
        console.log("Reported By ->", reportedByCJ);

        // Referred By - contact-search combo; require EXACT text match, else "Other"
        let referredByText = mapReferredByCreateJob(referredByRaw);
        let refEl = document.getElementById(CJ.ReferredBy);
        if (referredByText && refEl) {
            let refCombo = window.$find && window.$find(CJ.ReferredBy);
            let matched = false;

            if (refCombo) {
                await new Promise((resolve) => {
                    let handler = function() {
                        let items = refCombo.get_items();
                        for (let i = 0; i < items.get_count(); i++) {
                            let item = items.getItem(i);
                            let t = (item.get_text() || "").toLowerCase().trim();
                            if (t === referredByText.toLowerCase().trim()) {   // EXACT only
                                try { item.select(); } catch (e) {}
                                setDropdownValue(refEl, item.get_value(), item.get_text(), true);
                                console.log(`✓ Referred By exact match -> "${item.get_text()}"`);
                                matched = true;
                                break;
                            }
                        }
                        refCombo.remove_itemsRequested(handler);
                        resolve();
                    };
                    refCombo.add_itemsRequested(handler);
                    try { refCombo.requestItems(referredByText, false); }
                    catch (e) { refCombo.remove_itemsRequested(handler); resolve(); }
                    setTimeout(() => { refCombo.remove_itemsRequested(handler); resolve(); }, 6000);
                });
            }

            // Known-value fallback for servpro.com (captured from live ClientState)
            if (!matched && referredByText === "servpro.com") {
                setDropdownValue(refEl, "51877:Marketing Campaign", "servpro.com", true);
                console.log("✓ Referred By set via known-value fallback (servpro.com)");
                matched = true;
            }

            // Anything unmatched -> Other
            if (!matched) {
                let ok = setRadComboByText(refEl, "Other", true);
                if (!ok) {
                    await setLoadOnDemandCombo(CJ.ReferredBy, "Other");
                }
                console.log("Referred By: no exact match - set to Other");
            }
        } else if (refEl) {
            setRadComboByText(refEl, "Other", true) || await setLoadOnDemandCombo(CJ.ReferredBy, "Other");
            console.log("Referred By: nothing mapped - set to Other");
        }

        // 5. Zip-based lookups: Office Name (preloaded) + Custom Code (load-on-demand)
        let franchiseKey = resolveFranchise(lossParsed.zip, lossParsed.city, data[COLUMN.EnvironmentalCode]);
        console.log("Parsed loss address:", lossParsed, "-> franchise:", franchiseKey);
        if (!franchiseKey) console.log("⚠ No franchise resolved - Office / Custom Code left untouched");

        if (franchiseKey) {
            let group = officeGroupMap[franchiseKey];
            if (group) {
                let officeEl = document.getElementById(CJ.Office);
                if (officeEl) setRadComboByText(officeEl, `SERVPRO of ${group}`, true);
            }
            let customCodeText = customCodeMap[franchiseKey];
            if (customCodeText) {
                await setLoadOnDemandCombo(CJ.CustomCode, customCodeText);
            }
        }

        // 6. Loss Type & Secondary Loss Type - LOAD ON DEMAND, and they cascade from Loss Category,
        //    so give the page a moment after Loss Category was set before requesting items.
        let lossTypeInfo = lookupByKeyword(lossTypeMap, typeOfLoss) || DEFAULT_LOSS_TYPE;
        await new Promise(r => setTimeout(r, 800));
        await setLoadOnDemandCombo(CJ.LossType, lossTypeInfo.lossType);
        await new Promise(r => setTimeout(r, 500));
        await setLoadOnDemandCombo(CJ.SecondaryLossType, lossTypeInfo.secondary);

        // 7. Source of Loss - preloaded combo; word-boundary matcher, falls back to "Other"
        let sourceMatch = matchSourceOfLoss(causeOfLoss, typeOfLoss) || "Other";
        console.log("Cause of Loss:", causeOfLoss, "-> Source of Loss:", sourceMatch);
        let sourceEl = document.getElementById(CJ.SourceOfLoss);
        if (sourceEl) {
            let ok = setRadComboByText(sourceEl, sourceMatch, true);
            if (!ok && sourceMatch !== "Other") {
                setRadComboByText(sourceEl, "Other", true);
            }
        }

// 8. Internal Participants: ONLY the Estimator box (= Scheduled PM). The rest cascade on their own.
if (scheduledPM !== "**NOT ASSIGNED**") {
    let estimatorMatch = await findEstimatorMatch(scheduledPM);
    if (estimatorMatch) {
        let estimatorEl = document.getElementById(CJ.Estimator);
        if (estimatorEl) {
            setDropdownValue(estimatorEl, estimatorMatch.Value, estimatorMatch.Text, true);
            console.log(`✓ Estimator: "${scheduledPM}" -> "${estimatorMatch.Text}" (${estimatorMatch.Value})`);
        }
    } else {
        console.log(`✗ No Estimator match for "${scheduledPM}"`);
    }
}

        // 9. External Participants: ONLY Insurance Carrier - "Self-Pay" or the carrier name
        let carrierTarget = isSelfPay ? "Self-Pay" : insuranceCarrier;
        if (carrierTarget) {
            let carrierOk = await setLoadOnDemandCombo(CJ.InsuranceCarrier, carrierTarget);
            if (!carrierOk && isSelfPay) {
                let carrierEl = document.getElementById(CJ.InsuranceCarrier);
                if (carrierEl) {
                    setDropdownValue(carrierEl, "1171692", "Self-Pay", true);
                    console.log("✓ Insurance Carrier set via known-value fallback (Self-Pay / 1171692)");
                }
            }
        }

        // 9b. TPA Company (Alacrity / Westhill / SERVPRO HQ / Contractor Connection) from "How did you hear about SERVPRO?"
        const tpa = mapTPA(referredByRaw, data[COLUMN.ServproHQRef]);
        console.log("TPA Company:", referredByRaw, "->", tpa);
        if (tpa) await fillTPACompany(tpa);

        // 10. Policy Information: ONLY Claim Number + Policy Number
        if (claimNum) setRadTextBoxValue(CJ.ClaimNumber, claimNum);
        if (policyNum) setRadTextBoxValue(CJ.PolicyNumber, policyNum);

        // 11. Division checkboxes - based on Type of Loss
        let divisionLabel = lookupByKeyword(divisionMap, typeOfLoss) || DEFAULT_DIVISION;
        let divCheckboxId = DIVISION_CHECKBOXES[divisionLabel];
        let divCheckbox = divCheckboxId ? document.getElementById(divCheckboxId) : null;
        if (divCheckbox && !divCheckbox.checked) {
            divCheckbox.click();
            console.log("✓ Division checked:", divisionLabel);
        }

        // 12. Loss Description = same as WorkCenter Project Notes (journalNote)
        let prefix = propertyType ? propertyType.substring(0,3).toUpperCase() : "";
        let lossDescription = prefix && typeOfLoss ? `${prefix}/${typeOfLoss}` : (prefix || typeOfLoss || "");
        let descEl = document.getElementById(CJ.LossDescription);
        if (descEl) {
            descEl.value = lossDescription;
            descEl.dispatchEvent(new Event('input', { bubbles: true }));
            descEl.dispatchEvent(new Event('change', { bubbles: true }));
            // Telerik RadInput textarea also tracks state via $find
            let tb = window.$find && window.$find(CJ.LossDescription);
            if (tb && tb.set_value) { try { tb.set_value(lossDescription); } catch (e) {} }
            console.log("✓ Loss Description filled");
        }

        // NOTE: Payment Services section intentionally untouched.
        console.log("=== CreateJob autofill complete ===");
    }

    // ==========================================
    //  BUTTON CLICK -> ROUTE BY PAGE
    // ==========================================
    let autofillRunning = false;
    btn.addEventListener('click', async function() {
        if (autofillRunning) { setStatus('Autofill is still running - wait for it to finish.', true); return; }
        const rawData = inputBox.value.trim();
        if (!rawData) { alert('Please paste the data key.'); return; }
        const { data, warning } = parseDataKey(rawData);
        setStatus(warning || 'Filling...', !!warning);

        autofillRunning = true;
        btn.disabled = true;
        btn.style.opacity = '0.6';
        try {
            if (location.pathname.toLowerCase().includes('/createjob.aspx')) {
                await autofillCreateJob(data);
            } else {
                autofillWorkCenter(data);
                await sleep(10000);   // WorkCenter fills on timers; hold the button so a second click can't double-fire them
            }
            setStatus((warning ? warning + ' ' : '') + 'Done - review the form before saving.', !!warning);
        } catch (e) {
            console.error('Autofill failed:', e);
            setStatus('Autofill error: ' + (e && e.message ? e.message : e), true);
        } finally {
            autofillRunning = false;
            btn.disabled = false;
            btn.style.opacity = '';
        }
    });

    // Console access for testing the parsers on this page: IntakeAutofillDebug.parseAddress("123 Main St Richmond VA 23220")
    window.IntakeAutofillDebug = {
        parseAddress, splitName, extractPhone, extractEmail, parseDataDate, excelDateToJSDate, parseDataKey, cleanValue,
        resolveAddressPair, resolveFranchise, stateCandidates, matchSourceOfLoss, lookupByKeyword, lossTypeMap, divisionMap,
        mapReportedBy, mapReportedByCreateJob, mapReferredBy, mapReferredByCreateJob, mapTPA, fillTPACompany,
        setLoadOnDemandCombo, getCurrentDropdownValue, SCRIPT_VERSION,
        matchWorkCenterCauseOfLoss, wcCauseListFor, WC_CAUSE_OF_LOSS
    };
})();
