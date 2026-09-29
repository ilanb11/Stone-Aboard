import type { RegionName } from '../types'

export interface StateInfo {
  code: string
  name: string
  fips: string
  region: RegionName
  hogs: number // indicative inventory, million head
  cattle: number // indicative inventory, million head
  crops: number // indicative principal-crop acres planted, millions
  counties: string[]
}

// Inventories and crop acres are rounded, indicative figures in the spirit of
// USDA NASS annual inventory and acreage reports. Replace with the live NASS Quick Stats API for real use.
const S: StateInfo[] = [
  { code: 'AL', name: 'Alabama', fips: '01', region: 'Southeast', hogs: 0.05, cattle: 1.2, crops: 1.9, counties: ['Cullman', 'DeKalb', 'Marshall', 'Baldwin'] },
  { code: 'AZ', name: 'Arizona', fips: '04', region: 'Mountain', hogs: 0.15, cattle: 0.9, crops: 0.8, counties: ['Maricopa', 'Pinal', 'Yavapai', 'Cochise'] },
  { code: 'AR', name: 'Arkansas', fips: '05', region: 'Delta States', hogs: 0.13, cattle: 1.6, crops: 7.2, counties: ['Benton', 'Washington', 'Madison', 'Carroll'] },
  { code: 'CA', name: 'California', fips: '06', region: 'Pacific', hogs: 0.1, cattle: 5.0, crops: 3.1, counties: ['Tulare', 'Merced', 'Kings', 'Stanislaus', 'Fresno', 'Modoc'] },
  { code: 'CO', name: 'Colorado', fips: '08', region: 'Mountain', hogs: 0.75, cattle: 2.6, crops: 5.6, counties: ['Weld', 'Morgan', 'Yuma', 'Kiowa', 'Logan'] },
  { code: 'CT', name: 'Connecticut', fips: '09', region: 'Northeast', hogs: 0.004, cattle: 0.04, crops: 0.05, counties: ['Litchfield', 'New London'] },
  { code: 'DE', name: 'Delaware', fips: '10', region: 'Northeast', hogs: 0.004, cattle: 0.01, crops: 0.4, counties: ['Sussex', 'Kent'] },
  { code: 'FL', name: 'Florida', fips: '12', region: 'Southeast', hogs: 0.01, cattle: 1.6, crops: 1.0, counties: ['Okeechobee', 'Osceola', 'Highlands', 'Polk'] },
  { code: 'GA', name: 'Georgia', fips: '13', region: 'Southeast', hogs: 0.06, cattle: 1.0, crops: 3.0, counties: ['Colquitt', 'Burke', 'Morgan', 'Laurens'] },
  { code: 'ID', name: 'Idaho', fips: '16', region: 'Mountain', hogs: 0.03, cattle: 2.5, crops: 3.9, counties: ['Gooding', 'Jerome', 'Twin Falls', 'Canyon', 'Owyhee'] },
  { code: 'IL', name: 'Illinois', fips: '17', region: 'Corn Belt', hogs: 5.4, cattle: 1.0, crops: 21.8, counties: ['Henry', 'Warren', 'Hancock', 'Jo Daviess', 'Effingham', 'Fulton'] },
  { code: 'IN', name: 'Indiana', fips: '18', region: 'Corn Belt', hogs: 4.4, cattle: 0.8, crops: 11.9, counties: ['Carroll', 'Daviess', 'Decatur', 'Jackson', 'Elkhart'] },
  { code: 'IA', name: 'Iowa', fips: '19', region: 'Corn Belt', hogs: 24.5, cattle: 3.5, crops: 23.4, counties: ['Sioux', 'Plymouth', 'Washington', 'Hardin', 'Hamilton', 'Kossuth', 'Lyon', 'Wright'] },
  { code: 'KS', name: 'Kansas', fips: '20', region: 'Northern Plains', hogs: 1.9, cattle: 6.0, crops: 22.6, counties: ['Finney', 'Ford', 'Seward', 'Scott', 'Butler', 'Greenwood', 'Haskell'] },
  { code: 'KY', name: 'Kentucky', fips: '21', region: 'Appalachian', hogs: 0.4, cattle: 2.0, crops: 4.9, counties: ['Barren', 'Warren', 'Christian', 'Hart'] },
  { code: 'LA', name: 'Louisiana', fips: '22', region: 'Delta States', hogs: 0.01, cattle: 0.8, crops: 3.2, counties: ['Beauregard', 'Vernon', 'Allen'] },
  { code: 'ME', name: 'Maine', fips: '23', region: 'Northeast', hogs: 0.005, cattle: 0.08, crops: 0.2, counties: ['Aroostook', 'Kennebec'] },
  { code: 'MD', name: 'Maryland', fips: '24', region: 'Northeast', hogs: 0.02, cattle: 0.2, crops: 1.3, counties: ['Frederick', 'Washington', 'Carroll'] },
  { code: 'MA', name: 'Massachusetts', fips: '25', region: 'Northeast', hogs: 0.01, cattle: 0.03, crops: 0.05, counties: ['Worcester', 'Hampshire'] },
  { code: 'MI', name: 'Michigan', fips: '26', region: 'Lake States', hogs: 1.2, cattle: 1.1, crops: 6.1, counties: ['Allegan', 'Cass', 'Huron', 'Clinton', 'Ottawa'] },
  { code: 'MN', name: 'Minnesota', fips: '27', region: 'Lake States', hogs: 9.3, cattle: 2.1, crops: 16.2, counties: ['Martin', 'Nobles', 'Blue Earth', 'Stearns', 'Rock', 'Renville'] },
  { code: 'MS', name: 'Mississippi', fips: '28', region: 'Delta States', hogs: 0.3, cattle: 0.9, crops: 4.6, counties: ['Pontotoc', 'Jones', 'Lincoln'] },
  { code: 'MO', name: 'Missouri', fips: '29', region: 'Corn Belt', hogs: 3.4, cattle: 3.9, crops: 12.3, counties: ['Sullivan', 'Mercer', 'Vernon', 'Texas', 'Lawrence', 'Lafayette'] },
  { code: 'MT', name: 'Montana', fips: '30', region: 'Mountain', hogs: 0.2, cattle: 2.2, crops: 9.6, counties: ['Beaverhead', 'Big Horn', 'Carter', 'Yellowstone', 'Fergus'] },
  { code: 'NE', name: 'Nebraska', fips: '31', region: 'Northern Plains', hogs: 3.7, cattle: 6.3, crops: 19.2, counties: ['Custer', 'Cuming', 'Platte', 'Dawson', 'Lincoln', 'Cherry', 'Holt'] },
  { code: 'NV', name: 'Nevada', fips: '32', region: 'Mountain', hogs: 0.01, cattle: 0.4, crops: 0.3, counties: ['Elko', 'Humboldt', 'Churchill'] },
  { code: 'NH', name: 'New Hampshire', fips: '33', region: 'Northeast', hogs: 0.004, cattle: 0.03, crops: 0.03, counties: ['Grafton', 'Merrimack'] },
  { code: 'NJ', name: 'New Jersey', fips: '34', region: 'Northeast', hogs: 0.006, cattle: 0.03, crops: 0.3, counties: ['Salem', 'Sussex'] },
  { code: 'NM', name: 'New Mexico', fips: '35', region: 'Mountain', hogs: 0.002, cattle: 1.3, crops: 1.1, counties: ['Chaves', 'Curry', 'Roosevelt', 'Doña Ana'] },
  { code: 'NY', name: 'New York', fips: '36', region: 'Northeast', hogs: 0.07, cattle: 1.4, crops: 3.0, counties: ['Wyoming', 'Genesee', 'Cayuga', 'St. Lawrence'] },
  { code: 'NC', name: 'North Carolina', fips: '37', region: 'Appalachian', hogs: 8.3, cattle: 0.8, crops: 4.4, counties: ['Duplin', 'Sampson', 'Bladen', 'Wayne', 'Robeson', 'Greene'] },
  { code: 'ND', name: 'North Dakota', fips: '38', region: 'Northern Plains', hogs: 0.15, cattle: 1.8, crops: 20.7, counties: ['Stutsman', 'Morton', 'McIntosh', 'Grant'] },
  { code: 'OH', name: 'Ohio', fips: '39', region: 'Corn Belt', hogs: 2.9, cattle: 1.2, crops: 10.0, counties: ['Mercer', 'Darke', 'Wayne', 'Putnam', 'Hardin'] },
  { code: 'OK', name: 'Oklahoma', fips: '40', region: 'Southern Plains', hogs: 2.1, cattle: 4.8, crops: 8.9, counties: ['Texas', 'Beaver', 'Osage', 'Kay', 'Custer'] },
  { code: 'OR', name: 'Oregon', fips: '41', region: 'Pacific', hogs: 0.01, cattle: 1.2, crops: 2.1, counties: ['Harney', 'Malheur', 'Klamath', 'Umatilla'] },
  { code: 'PA', name: 'Pennsylvania', fips: '42', region: 'Northeast', hogs: 1.3, cattle: 1.4, crops: 3.6, counties: ['Lancaster', 'Franklin', 'Lebanon', 'Berks', 'Juniata'] },
  { code: 'RI', name: 'Rhode Island', fips: '44', region: 'Northeast', hogs: 0.002, cattle: 0.004, crops: 0.01, counties: ['Washington'] },
  { code: 'SC', name: 'South Carolina', fips: '45', region: 'Southeast', hogs: 0.2, cattle: 0.3, crops: 1.5, counties: ['Orangeburg', 'Lancaster', 'Edgefield'] },
  { code: 'SD', name: 'South Dakota', fips: '46', region: 'Northern Plains', hogs: 2.1, cattle: 3.6, crops: 16.4, counties: ['Minnehaha', 'Turner', 'Hutchinson', 'Meade', 'Perkins', 'Tripp'] },
  { code: 'TN', name: 'Tennessee', fips: '47', region: 'Appalachian', hogs: 0.2, cattle: 1.7, crops: 4.2, counties: ['Greene', 'Lincoln', 'Maury', 'Sumner'] },
  { code: 'TX', name: 'Texas', fips: '48', region: 'Southern Plains', hogs: 1.1, cattle: 12.2, crops: 19.6, counties: ['Deaf Smith', 'Castro', 'Parmer', 'Hale', 'Erath', 'King', 'Brazos', 'Gonzales'] },
  { code: 'UT', name: 'Utah', fips: '49', region: 'Mountain', hogs: 0.9, cattle: 0.8, crops: 1.0, counties: ['Beaver', 'Cache', 'Sanpete', 'Millard'] },
  { code: 'VT', name: 'Vermont', fips: '50', region: 'Northeast', hogs: 0.004, cattle: 0.2, crops: 0.2, counties: ['Franklin', 'Addison'] },
  { code: 'VA', name: 'Virginia', fips: '51', region: 'Appalachian', hogs: 0.2, cattle: 1.3, crops: 2.2, counties: ['Rockingham', 'Augusta', 'Southampton', 'Fauquier'] },
  { code: 'WA', name: 'Washington', fips: '53', region: 'Pacific', hogs: 0.02, cattle: 1.1, crops: 3.9, counties: ['Yakima', 'Whatcom', 'Grant', 'Walla Walla'] },
  { code: 'WV', name: 'West Virginia', fips: '54', region: 'Appalachian', hogs: 0.005, cattle: 0.4, crops: 0.3, counties: ['Greenbrier', 'Hardy', 'Monroe'] },
  { code: 'WI', name: 'Wisconsin', fips: '55', region: 'Lake States', hogs: 0.3, cattle: 3.4, crops: 8.2, counties: ['Marathon', 'Clark', 'Grant', 'Fond du Lac', 'Manitowoc', 'Dane'] },
  { code: 'WY', name: 'Wyoming', fips: '56', region: 'Mountain', hogs: 0.1, cattle: 1.2, crops: 1.4, counties: ['Goshen', 'Platte', 'Fremont', 'Sheridan'] },
]

export const STATES: Record<string, StateInfo> = Object.fromEntries(S.map((s) => [s.code, s]))
export const STATE_LIST = S
export const STATE_BY_FIPS: Record<string, StateInfo> = Object.fromEntries(S.map((s) => [s.fips, s]))

export const REGIONS: RegionName[] = ['Pacific', 'Mountain', 'Northern Plains', 'Southern Plains', 'Lake States', 'Corn Belt', 'Delta States', 'Appalachian', 'Southeast', 'Northeast']
