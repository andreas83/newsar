-- Migration: Expand geo_normalization mappings
-- Adds ~200 new mappings for unmapped geoPov values including:
-- - Native language names (España→Spain, Deutschland→Germany, etc.)
-- - Cities→Countries
-- - Regions/States→Countries
-- - Special regions (Middle East, Europe, etc.)
-- - Bodies of water→Nearest region

-- ═══════════════════════════════════════════════════════════════════
-- NATIVE LANGUAGE COUNTRY NAMES
-- ═══════════════════════════════════════════════════════════════════

-- Spanish
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('España', 'Spain', 'Europe'),
  ('Estados Unidos', 'United States', 'North America'),
  ('Nueva York', 'United States', 'North America'),
  ('Francia', 'France', 'Europe'),
  ('Irán', 'Iran', 'Middle East'),
  ('Italia', 'Italy', 'Europe'),
  ('Oriente Próximo', 'Middle East', 'Middle East'),
  ('Oriente Medio', 'Middle East', 'Middle East'),
  ('México', 'Mexico', 'North America'),
  ('Brasil', 'Brazil', 'South America'),
  ('Bruselas', 'Belgium', 'Europe'),
  ('París', 'France', 'Europe'),
  ('Los Ángeles', 'United States', 'North America'),
  ('Ucrania', 'Ukraine', 'Europe'),
  ('Países Bajos', 'Netherlands', 'Europe'),
  ('Espagne', 'Spain', 'Europe'),
  ('Londres', 'United Kingdom', 'Europe'),
  ('Reino Unido', 'United Kingdom', 'Europe'),
  ('Roma', 'Italy', 'Europe'),
  ('Cataluña', 'Spain', 'Europe'),
  ('Casa Blanca', 'United States', 'North America')
ON CONFLICT (raw_value) DO NOTHING;

-- German
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Deutschland', 'Germany', 'Europe'),
  ('Österreich', 'Austria', 'Europe'),
  ('Frankreich', 'France', 'Europe'),
  ('Russland', 'Russia', 'Europe'),
  ('Ungarn', 'Hungary', 'Europe'),
  ('Dänemark', 'Denmark', 'Europe'),
  ('Kuba', 'Cuba', 'Caribbean'),
  ('Syrien', 'Syria', 'Middle East'),
  ('Spanien', 'Spain', 'Europe'),
  ('Allemagne', 'Germany', 'Europe'),
  ('Bundesrepublik Deutschland', 'Germany', 'Europe'),
  ('Straße von Hormus', 'Strait of Hormuz', 'Middle East'),
  ('Ostsee', 'Baltic Sea', 'Europe'),
  ('Ostsee (Baltic Sea)', 'Baltic Sea', 'Europe'),
  ('Mond', 'Moon', 'Space'),
  ('Israël', 'Israel', 'Middle East'),
  ('Rom', 'Italy', 'Europe'),
  ('DDR', 'Germany', 'Europe'),
  ('Italie', 'Italy', 'Europe'),
  ('Sénégal', 'Senegal', 'Africa')
ON CONFLICT (raw_value) DO NOTHING;

-- French
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Moyen-Orient', 'Middle East', 'Middle East'),
  ('Europa', 'Europe', 'Europe'),
  ('Nouvelle-Calédonie', 'France', 'Oceania'),
  ('Île-de-France', 'France', 'Europe'),
  ('Cameroun', 'Cameroon', 'Africa'),
  ('Bénin', 'Benin', 'Africa'),
  ('Corse', 'France', 'Europe'),
  ('Lune', 'Moon', 'Space'),
  ('Great Britain', 'United Kingdom', 'Europe'),
  ('United Kingdom (UK)', 'United Kingdom', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- CITIES → COUNTRIES
-- ═══════════════════════════════════════════════════════════════════

-- Spain cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Madrid', 'Spain', 'Europe'),
  ('Barcelona', 'Spain', 'Europe'),
  ('Sevilla', 'Spain', 'Europe'),
  ('Valencia', 'Spain', 'Europe'),
  ('Málaga', 'Spain', 'Europe'),
  ('Zaragoza', 'Spain', 'Europe'),
  ('Bilbao', 'Spain', 'Europe'),
  ('Santander', 'Spain', 'Europe'),
  ('Almería', 'Spain', 'Europe'),
  ('Girona', 'Spain', 'Europe'),
  ('Palma', 'Spain', 'Europe'),
  ('Palma de Mallorca', 'Spain', 'Europe'),
  ('Córdoba', 'Spain', 'Europe'),
  ('Oviedo', 'Spain', 'Europe'),
  ('Valladolid', 'Spain', 'Europe'),
  ('Tenerife', 'Spain', 'Europe'),
  ('Gran Canaria', 'Spain', 'Europe'),
  ('Alicante', 'Spain', 'Europe'),
  ('Granada', 'Spain', 'Europe'),
  ('Huelva', 'Spain', 'Europe'),
  ('Jaén', 'Spain', 'Europe'),
  ('Tarragona', 'Spain', 'Europe'),
  ('Lleida', 'Spain', 'Europe'),
  ('Sagunto', 'Spain', 'Europe'),
  ('Badalona', 'Spain', 'Europe'),
  ('Mallorca', 'Spain', 'Europe'),
  ('Ceuta', 'Spain', 'Europe'),
  ('Murcia', 'Spain', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- German cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Frankfurt', 'Germany', 'Europe'),
  ('Hamburg', 'Germany', 'Europe'),
  ('München', 'Germany', 'Europe'),
  ('Munich', 'Germany', 'Europe'),
  ('Köln', 'Germany', 'Europe'),
  ('Dresden', 'Germany', 'Europe'),
  ('Leipzig', 'Germany', 'Europe'),
  ('Stuttgart', 'Germany', 'Europe'),
  ('Dortmund', 'Germany', 'Europe'),
  ('Bonn', 'Germany', 'Europe'),
  ('Hanau', 'Germany', 'Europe'),
  ('Wiesbaden', 'Germany', 'Europe'),
  ('Wismar', 'Germany', 'Europe'),
  ('Karlsruhe', 'Germany', 'Europe'),
  ('Mainz', 'Germany', 'Europe'),
  ('Timmendorfer Strand', 'Germany', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- French cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Lyon', 'France', 'Europe'),
  ('Nice', 'France', 'Europe'),
  ('Marseille', 'France', 'Europe'),
  ('Toulouse', 'France', 'Europe'),
  ('Bordeaux', 'France', 'Europe'),
  ('Le Havre', 'France', 'Europe'),
  ('Lille', 'France', 'Europe'),
  ('Nantes', 'France', 'Europe'),
  ('Cannes', 'France', 'Europe'),
  ('Aix-en-Provence', 'France', 'Europe'),
  ('Carcassonne', 'France', 'Europe'),
  ('Saint-Denis', 'France', 'Europe'),
  ('Fresnes', 'France', 'Europe'),
  ('Strasbourg', 'France', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- US cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Los Angeles', 'United States', 'North America'),
  ('Minneapolis', 'United States', 'North America'),
  ('Miami', 'United States', 'North America'),
  ('New York City', 'United States', 'North America'),
  ('San Francisco', 'United States', 'North America'),
  ('Houston', 'United States', 'North America'),
  ('Las Vegas', 'United States', 'North America'),
  ('New Orleans', 'United States', 'North America'),
  ('Chicago', 'United States', 'North America'),
  ('Boston', 'United States', 'North America'),
  ('Silicon Valley', 'United States', 'North America'),
  ('Hollywood', 'United States', 'North America'),
  ('Wall Street', 'United States', 'North America'),
  ('Mar-a-Lago', 'United States', 'North America'),
  ('Manhattan', 'United States', 'North America'),
  ('Tucson, Arizona', 'United States', 'North America'),
  ('Indian Wells', 'United States', 'North America'),
  ('Jupiter Island', 'United States', 'North America'),
  ('Davos', 'Switzerland', 'Europe'),
  ('LaGuardia Airport', 'United States', 'North America'),
  ('White House', 'United States', 'North America'),
  ('Downing Street', 'United Kingdom', 'Europe'),
  ('Kennedy Space Center', 'United States', 'North America')
ON CONFLICT (raw_value) DO NOTHING;

-- Australian cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Sydney', 'Australia', 'Asia-Pacific'),
  ('Melbourne', 'Australia', 'Asia-Pacific'),
  ('Brisbane', 'Australia', 'Asia-Pacific'),
  ('Bondi Beach', 'Australia', 'Asia-Pacific'),
  ('Bondi', 'Australia', 'Asia-Pacific'),
  ('Bondi beach', 'Australia', 'Asia-Pacific')
ON CONFLICT (raw_value) DO NOTHING;

-- Other cities
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Milan', 'Italy', 'Europe'),
  ('Prague', 'Czech Republic', 'Europe'),
  ('Amsterdam', 'Netherlands', 'Europe'),
  ('Salzburg', 'Austria', 'Europe'),
  ('Lisbon', 'Portugal', 'Europe'),
  ('Oslo', 'Norway', 'Europe'),
  ('Maastricht', 'Netherlands', 'Europe'),
  ('Torun', 'Poland', 'Europe'),
  ('Toronto', 'Canada', 'North America'),
  ('Shenzhen', 'China', 'Asia-Pacific'),
  ('Kuala Lumpur', 'Malaysia', 'Asia-Pacific'),
  ('Karachi', 'Pakistan', 'Asia'),
  ('Marrakech', 'Morocco', 'Africa'),
  ('Odesa', 'Ukraine', 'Europe'),
  ('Aleppo', 'Syria', 'Middle East'),
  ('Montecarlo', 'Monaco', 'Europe'),
  ('Cortina d''Ampezzo', 'Italy', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- REGIONS / STATES → COUNTRIES
-- ═══════════════════════════════════════════════════════════════════

-- Spanish regions
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Catalunya', 'Spain', 'Europe'),
  ('Catalonia', 'Spain', 'Europe'),
  ('Andalucía', 'Spain', 'Europe'),
  ('Andalusia', 'Spain', 'Europe'),
  ('Comunidad Valenciana', 'Spain', 'Europe'),
  ('Comunitat Valenciana', 'Spain', 'Europe'),
  ('València', 'Spain', 'Europe'),
  ('Extremadura', 'Spain', 'Europe'),
  ('Castilla y León', 'Spain', 'Europe'),
  ('País Vasco', 'Spain', 'Europe'),
  ('Euskadi', 'Spain', 'Europe'),
  ('Galicia', 'Spain', 'Europe'),
  ('Comunidad de Madrid', 'Spain', 'Europe'),
  ('Canary Islands', 'Spain', 'Europe'),
  ('Aragón', 'Spain', 'Europe'),
  ('Cantabria', 'Spain', 'Europe'),
  ('Navarra', 'Spain', 'Europe'),
  ('La Moncloa', 'Spain', 'Europe'),
  ('Moncloa', 'Spain', 'Europe'),
  ('La Bañeza', 'Spain', 'Europe'),
  ('Adamuz', 'Spain', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- German states
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Rheinland-Pfalz', 'Germany', 'Europe'),
  ('Rhineland-Palatinate', 'Germany', 'Europe'),
  ('Hessen', 'Germany', 'Europe'),
  ('Bayern', 'Germany', 'Europe'),
  ('Baden-Württemberg', 'Germany', 'Europe'),
  ('Nordrhein-Westfalen', 'Germany', 'Europe'),
  ('Niedersachsen', 'Germany', 'Europe'),
  ('Mecklenburg-Vorpommern', 'Germany', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- French regions
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Pas-de-Calais', 'France', 'Europe'),
  ('Yvelines', 'France', 'Europe'),
  ('Corrèze', 'France', 'Europe'),
  ('Aveyron', 'France', 'Europe'),
  ('Gorton and Denton', 'United Kingdom', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- US states
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Minnesota', 'United States', 'North America'),
  ('Arizona', 'United States', 'North America'),
  ('Colorado', 'United States', 'North America'),
  ('Michigan', 'United States', 'North America'),
  ('Virginia', 'United States', 'North America'),
  ('Hawaii', 'United States', 'North America'),
  ('New Mexico', 'United States', 'North America'),
  ('Tennessee', 'United States', 'North America'),
  ('Utah', 'United States', 'North America'),
  ('Georgia', 'United States', 'North America'),
  ('Louisiana', 'United States', 'North America'),
  ('North Carolina', 'United States', 'North America'),
  ('New Jersey', 'United States', 'North America'),
  ('Illinois', 'United States', 'North America'),
  ('Oregon', 'United States', 'North America'),
  ('Puerto Rico', 'United States', 'North America')
ON CONFLICT (raw_value) DO NOTHING;

-- Australian states
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('New South Wales', 'Australia', 'Asia-Pacific'),
  ('Queensland', 'Australia', 'Asia-Pacific'),
  ('Victoria', 'Australia', 'Asia-Pacific'),
  ('Western Australia', 'Australia', 'Asia-Pacific'),
  ('South Australia', 'Australia', 'Asia-Pacific'),
  ('Tasmania', 'Australia', 'Asia-Pacific')
ON CONFLICT (raw_value) DO NOTHING;

-- UK regions
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Scotland', 'United Kingdom', 'Europe'),
  ('Wales', 'United Kingdom', 'Europe'),
  ('England and Wales', 'United Kingdom', 'Europe'),
  ('Kent', 'United Kingdom', 'Europe'),
  ('Birmingham', 'United Kingdom', 'Europe'),
  ('Manchester', 'United Kingdom', 'Europe'),
  ('Liverpool', 'United Kingdom', 'Europe')
ON CONFLICT (raw_value) DO NOTHING;

-- Canadian regions
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('British Columbia', 'Canada', 'North America'),
  ('Quebec', 'Canada', 'North America'),
  ('Tumbler Ridge', 'Canada', 'North America')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- COUNTRIES NOT YET MAPPED
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Hong Kong', 'China', 'Asia-Pacific'),
  ('Cuba', 'Cuba', 'Caribbean'),
  ('Greenland', 'Greenland', 'North America'),
  ('Bangladesh', 'Bangladesh', 'Asia'),
  ('Nepal', 'Nepal', 'Asia'),
  ('Ghana', 'Ghana', 'Africa'),
  ('Senegal', 'Senegal', 'Africa'),
  ('New Zealand', 'New Zealand', 'Asia-Pacific'),
  ('Sri Lanka', 'Sri Lanka', 'Asia'),
  ('Honduras', 'Honduras', 'Central America'),
  ('Somalia', 'Somalia', 'Africa'),
  ('Cambodia', 'Cambodia', 'Asia'),
  ('Uganda', 'Uganda', 'Africa'),
  ('Panama', 'Panama', 'Central America'),
  ('Monaco', 'Monaco', 'Europe'),
  ('Algeria', 'Algeria', 'Africa'),
  ('Haiti', 'Haiti', 'Caribbean'),
  ('Bulgaria', 'Bulgaria', 'Europe'),
  ('Cyprus', 'Cyprus', 'Europe'),
  ('Slovenia', 'Slovenia', 'Europe'),
  ('Madagascar', 'Madagascar', 'Africa'),
  ('Ecuador', 'Ecuador', 'South America'),
  ('Belarus', 'Belarus', 'Europe'),
  ('Serbia', 'Serbia', 'Europe'),
  ('Tunisia', 'Tunisia', 'Africa'),
  ('Mali', 'Mali', 'Africa'),
  ('Rwanda', 'Rwanda', 'Africa'),
  ('Niger', 'Niger', 'Africa'),
  ('Guatemala', 'Guatemala', 'Central America'),
  ('Mozambique', 'Mozambique', 'Africa'),
  ('Zimbabwe', 'Zimbabwe', 'Africa'),
  ('Estonia', 'Estonia', 'Europe'),
  ('South Sudan', 'South Sudan', 'Africa'),
  ('Lithuania', 'Lithuania', 'Europe'),
  ('Burkina Faso', 'Burkina Faso', 'Africa'),
  ('Bolivia', 'Bolivia', 'South America'),
  ('Costa Rica', 'Costa Rica', 'Central America'),
  ('El Salvador', 'El Salvador', 'Central America'),
  ('Bosnia and Herzegovina', 'Bosnia and Herzegovina', 'Europe'),
  ('Vatican', 'Vatican', 'Europe'),
  ('Guinea-Bissau', 'Guinea-Bissau', 'Africa'),
  ('Somaliland', 'Somalia', 'Africa'),
  ('Kosovo', 'Kosovo', 'Europe'),
  ('Andorra', 'Andorra', 'Europe'),
  ('Cameroon', 'Cameroon', 'Africa'),
  ('Benin', 'Benin', 'Africa'),
  ('Darfur', 'Sudan', 'Africa'),
  ('Turkiye', 'Turkey', 'Middle East'),
  ('Democratic Republic of the Congo', 'Democratic Republic of the Congo', 'Africa'),
  ('Democratic Republic of Congo', 'Democratic Republic of the Congo', 'Africa'),
  ('Bali', 'Indonesia', 'Asia-Pacific'),
  ('Gaza Strip', 'Palestine', 'Middle East'),
  ('Rafah Crossing', 'Palestine', 'Middle East'),
  ('East Jerusalem', 'Palestine', 'Middle East'),
  ('Kharg Island', 'Iran', 'Middle East')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SPECIAL REGIONS (not countries, used for regional grouping)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Middle East', 'Middle East', 'Middle East'),
  ('Europe', 'Europe', 'Europe'),
  ('Africa', 'Africa', 'Africa'),
  ('Asia', 'Asia', 'Asia'),
  ('Southeast Asia', 'Southeast Asia', 'Asia'),
  ('South China Sea', 'South China Sea', 'Asia-Pacific'),
  ('Strait of Hormuz', 'Strait of Hormuz', 'Middle East'),
  ('Persian Gulf', 'Persian Gulf', 'Middle East'),
  ('Mediterranean Sea', 'Mediterranean Sea', 'Europe'),
  ('Baltic Sea', 'Baltic Sea', 'Europe'),
  ('Eurozone', 'Eurozone', 'Europe'),
  ('Moon', 'Moon', 'Space'),
  ('Luna', 'Moon', 'Space'),
  ('Earth', 'Earth', 'Earth'),
  ('International Space Station', 'International Space Station', 'Space'),
  ('International Space Station (ISS)', 'International Space Station', 'Space'),
  ('Antarctica', 'Antarctica', 'Antarctica'),
  ('Caribbean', 'Caribbean', 'Caribbean'),
  ('Buckelwal', 'Earth', 'Earth'),
  ('Wang Fuk Court', 'China', 'Asia-Pacific')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- SPORTS VENUES (map to host country)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  ('Santiago Bernabéu', 'Spain', 'Europe'),
  ('Camp Nou', 'Spain', 'Europe'),
  ('Parc des Princes', 'France', 'Europe'),
  ('Suzuka', 'Japan', 'Asia-Pacific'),
  ('Crans-Montana', 'Switzerland', 'Europe'),
  ('Hong Kong International Airport', 'China', 'Asia-Pacific')
ON CONFLICT (raw_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════

-- Count total mappings
-- SELECT COUNT(*) as total_mappings FROM geo_normalization;
