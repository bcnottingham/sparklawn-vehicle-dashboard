# Ford Telematics API Documentation

## API Endpoints: Token
POST /token
Retrieves a temporary bearer token based on the customer's clientId and clientSecret

### Request Body
Content type: application/x-www-form-urlencoded

| Name | Type | Required | Description |
|------|------|----------|-------------|
| clientId | string | Yes | clientId provided to customer by Ford. |
| clientSecret | string | Yes | clientSecret provided to customer by Ford. |

### Response
| Name | Type | Description |
|------|------|-------------|
| access_token | string | Bearer token to use for authentication for all other Telematics API endpoints. |
| token_type | string | Type of token, will always return "Bearer" |
| expires_in | timestamp | UTC timestamp at which the returned access_token will expire. This will be 5 minutes after the request time. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid clientId and/or clientSecret. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X POST  -H "Content-Type: application/x-www-form-urlencoded" --data "clientId=${clientId}" --data "clientSecret=${clientSecret}" https://${HOST}/vehicle-status-api/token"
```

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": "1675667857713"
}
```

## Status
GET /v1/vehicle/:vin/status
Retrieves last known state of each requested signal for the requested vehicle.

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| signal-filter | string | No | Comma seperated list of signals to include in response. ex: position,odometer. If null, default behavior is to show all signals. |

### Response
| Name | Type | Description |
|------|------|-------------|
| vin | string | Vehicle Identification Number. |
| fuelType | FuelTypeEnum | Fuel type of the vehicle. ex: Electric. |
| signals | Array[Signal] | List of timestamped signals. See Signal Schema for more details. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v1/vehicle/${VIN}/status?signal-filter=position,odometer"
```

```json
{
"vin": "1FMEU111111111111",
"fuelType": "Gas",
"signals": [
{
"position": {
"timestamp": "2023-01-26T22:01:01.663Z",
"value": {
"latitude": 42.296436,
"longitude": -83.207819
}
}
},
{
"odometer": {
"timestamp": "2023-01-26T22:01:01.663Z",
"value": 24000.0
}
}
]
}
```

## Driver Association
GET /v1/driver-association/:id
Retrieve the association record by id.

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| relations | Array[string] | No | Comma seperated list of relations to include in response. ex: Driver, Vehicle. If null, default behavior is to show no relations. |

### Response
| Name | Type | Description |
|------|------|-------------|
| id | UUID | ID of association record. |
| driver_id | UUID | Unique identifier of the driver. |
| vin | string | Vehicle Identification Number. |
| start_time | string | Start time of the association. |
| end_time | string | End time of the association. |
| relations | Relations | Relations object which holds Driver and Vehicle relations objects. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v1/driver-association/${id}?relations=Driver,Vehicle"
```

```json
{
    "id": "65570DED-76CD-4DA5-B321-05078479BC0C",
    "driver_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "vin": "1FMTF1RM2NMA94068",
    "start_time": "2024-09-03T13:12:33.000Z",
    "end_time": "2024-09-03T14:12:33.000",
    "relations": {
      "driver": {
        "first_name": "Sally",
        "last_name": "Smith",
        "country_code": "US",
        "email": "sally.smith@email.com",
        "timezone": "UTC"
      },
      "vehicle": {
        "id": "106B2FB1-6E53-4C1A-E2EE-1CC17F26028B",
        "vin": "1FMTF1RM2NMA94068",
        "name": "MyCarName1234",
        "make": "Ford",
        "model": "F-150",
        "year": "2024"
      }
    }
}
```

GET /v2/driver-association
Retrieve driver associations

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| active | boolean | No | If true will return only active driver associations. If null, defaults false. |
| driver-filter | Array[UUID] | No | Drivers to retrieve associations for. If null, will default to filter for driver making the request. |
| relations | Array[string] | No | Comma seperated list of relations to include in response. ex: Driver, Vehicle. If null, default behavior is to show no relations. |

### Response
| Name | Type | Description |
|------|------|-------------|
| id | UUID | ID of association record. |
| driver_id | UUID | Unique identifier of the driver. |
| vin | string | Vehicle Identification Number. |
| start_time | string | Start time of the association. |
| end_time | string | End time of the association. |
| relations | Relations | Relations object which holds Driver and Vehicle relations objects. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v2/driver-association?active=true&relations=Driver,Vehicle&driver-filter=3fa85f64-5717-4562-b3fc-2c963f66afa6"
```

```json
[
    {
        "id": "65570DED-76CD-4DA5-B321-05078479BC0C",
        "driver_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "vin": "1FMTF1RM2NMA94068",
        "start_time": "2024-09-03T13:12:33.000Z",
        "end_time": "2024-09-03T14:12:33.000Z",
        "relations": {
          "driver": {
            "first_name": "Sally",
            "last_name": "Smith",
            "country_code": "US",
            "email": "sally.smith@email.com",
            "timezone": "UTC"
          },
          "vehicle": {
            "id": "106B2FB1-6E53-4C1A-E2EE-1CC17F26028B",
            "vin": "1FMTF1RM2NMA94068",
            "name": "MyCarName1234",
            "make": "Ford",
            "model": "F-150",
            "year": "2024"
          }
        }
    }
]
```

POST /v1/driver-association
Create new driver association record

### Request Body
| Name | Type | Required | Description |
|------|------|----------|-------------|
| driver_id | UUID | Yes | Unique identifier of the driver. |
| vin | string | Yes | Vehicle Identification Number. |
| start_time | OffsetDateTime | Yes | Start time of the association. example: "2024-09-11T23:00:00.000Z". |

### Response
201 when created

### Response Codes
| Name | Description |
|------|-------------|
| 201 | Created. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X POST -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api" --data '{
    "driver_id": "a3ad4045-1213-4243-a884-0b004470a9cd",
    "vin": "1DTEW1C47KDB54736",
    "start_time": "2024-09-08T00:00:00.000Z"
}'
```

```
201 Created
```

PUT /v1/driver-association
End driver association for a vehicle association record with given end time.

### Request Body
| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | UUID | Yes | The id of association record wanting to update. |
| end_time | OffsetDateTime | Yes | End time of the association. example: "2024-09-11T23:00:00.000Z" |

### Response
204 when created

### Response Codes
| Name | Description |
|------|-------------|
| 204 | No Content. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X POST -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api" --data '{
    "id": "b3ac4045-1234-1234-a884-0b004470a9ce",
    "end_time": "2024-09-08T00:00:00.000Z"
}'
```

```
204 No Content
```

## Health
GET /v1/vehicle/:vin/health
Retrieves current list of open vehicle health alert (VHA) diagnostic processed events for a vehicle.

### Request Parameters
No additional request parameters supported.

### Response
| Name | Type | Description |
|------|------|-------------|
| vin | string | Vehicle Identification Number. |
| signals | Array[HealthSignalObject] | List of VHA diagnostic processed events. See Signal Schema for more details. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v1/vehicle/${VIN}/health"
```

```json
{
  "vin": "1FMEU111111111111",
  "signals": [
    {
      "tag": {
        "symptom": "The Brake system has detected a fault.",
        "severity": "URGENT",
        "category": "Powertrain",
        "action": "Ensure the parking brake is released. If the light remains on, the brake system should be inspected immediately by an authorized dealer. WARNING: Driving your vehicle with the brake warning indicator on is dangerous. A significant decrease in braking performance may occur. It will take you longer to stop your vehicle. Have your vehicle checked by your authorized dealer. Driving extended distances with the parking brake engaged can cause brake failure and the risk of personal injury."
      },
      "indicator_light": {
        "well_known_indicator": "BRAKE_WARNING",
        "indicator_state": "ON",
        "value": "600E28"
      },
      "dtc_code": null,
      "timestamp": "2023-01-26T22:01:01Z"
    },
    {
      "tag": {
        "symptom": "Your tire pressure warning is on due to the vehicle not receiving tire pressure information from one or more tires. This could be interference caused by electrical or electronic accessories on or around your vehicle. A fault within the vehicle can also cause this. Your vehicle is ok to drive, after checking all the tires are properly inflated.",
        "severity": "URGENT",
        "category": "Checks, Fluids & Filters",
        "action": "Accessories such as video equipment, anti-theft alarm, cell phone charger, or power supply that were recently added to the vehicle may be the cause of this fault. The fault may go away with moving or removing the equipment. If the concern continues in multiple locations, please contact your dealership immediately for service."
      },
      "indicator_light": {
        "well_known_indicator": "TIRE_PRESSURE_MONITOR_SYSTEM_WARNING",
        "indicator_state": "ON",
        "value": "600E27"
      },
      "dtc_code": "B124D",
      "timestamp": "2023-01-26T21:07:05Z",
    }
  ]
}
```

## History
GET /v1/vehicle/:vin/historical
Retrieves historical vehicle signals for a given VIN.

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| start-time | string | Yes | Start time of the query window. Must be before end-time. ISO 8601 formatted datetime string. |
| end-time | string | Yes | End time of the query window. Must be less than three days after start-time. ISO 8601 formatted datetime string. |
| resolution | Enum('hr') | No | Down samples signals to the specified resolution. (Default: null) |
| page-size | integer | No | Number of results to return. (Default: 1000, Max: 1000) |
| page | string | No | Pagination cursor. (Default: null) |
| signal-filter | string | No | Comma seperated list of signals to include in response. ex: position,odometer. If null, default behavior is to show all signals. |

Note: Page size returned may not be exact (ex: a requested page-size of 1000, may return slightly less than 1000, despite having a next page cursor).

### Response
| Name | Type | Description |
|------|------|-------------|
| vin | string | Vehicle Identification Number. |
| fuelType | FuelTypeEnum | Fuel type of the vehicle. ex: Electric. |
| start_time | string | Start time of the query window. ISO 8601 formatted datetime string. |
| end_time | string | End time of the query window. ISO 8601 formatted datetime string. |
| page_count | int | Number of signals returned. |
| next_page | string | Cursor value to request next-page of results. Will be null if no next page exists. |
| page_size | int | Requested page-size. |
| resolution | Enum('hr') | Requested resolution. |
| signals | Array[HistoricalSignal] | List of historical signals. See Signal Schema for more details. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer example\"" "https://${HOST}/vehicle-status-api/v1/vehicle/1FMEU111111111111/historical?start-time=2023-02-01T14:00:00Z&end-time=2023-02-01T15:00:00Z&page-size=3"
```

```json
{
  "vin": "1FMEU111111111111",
  "fuel_type": "Gas",
  "start_time": "2023-02-01T14:00:00Z",
  "end_time": "2023-02-01T15:00:00Z",
  "page_count": 3,
  "next_page": '1234',
  "page_size": 3,
  "resolution": null,
  "signals": [
    {
      "type": "position",
      "value": {
          "latitude": 1.0,
          "longitude": 2.0
      },
      "timestamp": "2023-02-01T14:55:30Z"
    },
    {
      "type": "odometer",
      "value": 1099.15,
      "timestamp": "2023-02-01T14:55:30Z"
    },
    {
      "type": "speed",
      "value": 15.6,
      "timestamp": "2023-02-01T14:55:30Z"
    }
  ]
}
```

## Trip
GET /v1/vehicle/:vin/trip
Retrieves a paged list of Trip History for vehicle(s) in your fleet between a start time and end time.

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| vin | string | Yes | Vehicle Identification Number. |
| start-time | string | Yes | ISO 8601 UTC timestamp representing the earliest time for which to return trip data. (inclusive) |
| end-time | string | Yes | ISO 8601 UTC timestamp representing the latest time for which to return trip data. (inclusive) |
| page | string | No | Page cursor. On first request should be null, and on subsequent requests should be set from next_page value of response if not null. |
| page-size | integer | No | Page size of limit. If null, default is 500, maximum is 1000. |

### Response
| Name | Type | Description |
|------|------|-------------|
| page | string | Current page cursor. |
| next_page | string | Page cursor that can be used to fetch next page if available; Otherwise, null. |
| previous_page | string | Page cursor that can be used to fetch previous page if available; Otherwise, null. |
| page_size | integer | Page size requested. |
| page_count | integer | Number vehicles returned for this page. |
| vehicle_name | string | Custom name assigned to the vehicle. |
| start_time | string | Request start given in ISO 8601 UTC timestamp (inclusive). |
| end_time | string | Request end given in ISO 8601 UTC timestamp (inclusive). |
| trips | Array[TripSummary] | List of trip summaries for a vehicle. Will return empty list if no trips found. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v1/vehicle/${VIN}/trip?start-time=2023-01-01T00:00:00Z&endTime=2023-02-01T00:00:00Z"
```

```json
{
"vin": "1FMEU111111111111",
"vehicle_name": "My New Vehicle",
"start_time": "2023-01-01T00:00:00Z",
"end_time": "2023-02-01T00:00:00Z",
"page": "MA==",
"next_page": "MQ==",
"previous_page": null,
"page_size": 500,
"page_count": 1,
"trips": [
{
"trip_start_time": "2023-10-02T00:00:00Z",
"start_position": {
"latitude": -46.93843,
"longitude": 75.98473
},
"start_odometer": 216.0,
"trip_end_time": "2023-10-02T01:00:00Z",
"end_position": {
"latitude": -46.93843,
"longitude": 75.98473
},
"end_odometer": 241.0,
"trip_distance": 42.0
}
]
}
```

## Vehicle Meta Data
GET /v1/vehicles
Retrieves list of enrolled vehicles in your fleet with metadata information on each vehicle. Please note this includes vehicles with product status "subscribed" and "processing unsubscribe"

### Request Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| page | string | No | Page cursor. On first request should be null, and on subsequent requests should be set from next_page value of response if not null. |
| page-size | integer | No | Page size of limit. If null, default is 100, maximum is 1000. |
| fields | string | No | Comma seperated list of fields to include in response. ex: vin,vehicle_name,make,model,year. If null, default behavior is to show all fields. |

### Response
| Name | Type | Description |
|------|------|-------------|
| next_page | string | Page cursor that can be used to fetch next page if available; Otherwise, null. |
| previous_page | string | Page cursor that can be used to fetch previous page if available; Otherwise, null. |
| page_size | integer | Page size requested. |
| page_count | integer | Number vehicles returned for this page. |
| vehicles | Array[VehicleMetadata] | List of vehicle metadata. See VehicleMetadat Schema for more details. |

### Response Codes
| Name | Description |
|------|-------------|
| 200 | Ok. |
| 400 | Bad Request - Request was malformed or invalid. |
| 401 | Unauthorized - Request includes invalid or expired authentication token. |
| 403 | Forbidden - Request was for a resource not assigned to the customer. |
| 404 | Not Found - Request was for a resource that was not found. |
| 412 | Precondition Failed - Request was for a resource not currently enrolled with Ford Telematics. |
| 429 | Too Many Requests - Client has exceeded the rate limit. |
| 5XX | Server Error - Something went wrong on our side. If the problem persists, please reach out to support. |

### Example
```bash
curl -X GET -H "Authorization: \"Bearer ${AUTH_TOKEN}\"" "https://${HOST}/vehicle-status-api/v1/vehicles?page-size=2"
```

```json
{
"next_page": "MQ==",
"previous_page": null,
"page_size": 2,
"page_count": 2,
"vehicles": [
{
"vin": "1FMEU111111111111",
"vehicle_name": "My Transit",
"make": "Ford",
"model": "Transit",
"year": 2022
},
{
"vin": "1FMEU111111111112",
"vehicle_name": "My Mustang",
"make": "Ford",
"model": "Mustang",
"year": 2023
}
]
}
```

# Schemas
Schemas for objects used in API requests and responses.

## Signal
| Name | Type | Description |
|------|------|-------------|
| $signal_name | SignalObject | ISO 8601 formatted datetime string representing the signal emit time. All values are in UTC timezone. |

## SignalObject
Signal availability in Multi-maker PIDs will vary by makes and models.

| Name | Type | Description |
|------|------|-------------|
| timestamp | string | ISO 8601 formatted datetime string representing the signal emit time. All values are in UTC. |
| value | object | Signal value. Formats vary based on signal type. See table below for more details. |

### Signal Types

| Signal Name | Value Type | Description |
|-------------|------------|-------------|
| position | PositionObject | Includes the latitude and longitude of the vehicle. Latitude: Units: degrees. Range: -90 to 90 Example: 42.326215 Longitude: Units: degrees Range: -180 to 180 Example: -83.211655 |
| odometer | double | Indicates the kilometers driven over the life of the vehicle. Units: kilometers Example: 1349 |
| ignition_status | IgnitionStatusEnum | Indicates the current ignition status of the vehicle. |
| oil_life_remaining | double | The percentage oil life remaining for the vehicle. Units: percentage Range: 0 to 100 Example: 10 |
| fuel_level | double | Indicates the percentage of fuel remaining as reported by the vehicle. Units: percentage Range: -5.217408 to 105.9786 Example: 41.413176 *Fuel level may show negative value when in reserve tank. |
| total_engine_time | double | Indicates the number of total seconds the engine has been running during the vehicle lifetime. Units: seconds Example: 102 Note: Zero time is not valid and can be caused by a quick ignition on/off cycle. This signal is not available on all makes and models. |
| battery_voltage | double | Number representing the current battery level in volts. Units: volts Range: 0 to 15.875 Example: 12.9375 |
| xev_battery_state_of_charge | double | State of charge of the XEV High Voltage battery expressed as a percentage. Units: percentage Range: 0 to 100 Example: 80 |
| xev_battery_range | double | Estimated battery range. Units: kilometer |
| xev_plug_charger_status | EVPlugChargerStatusEnum | Status of the electric vehicle's charger plug. |
| xev_battery_charge_display_status | EVBatteryChargeDisplayStatusEnum | Display that will show the charging status or the use of charge from a charging station. |
| heading | double | Indicates the direction in which the vehicle is moving represented in degrees. Units: degrees Range: 0 to 360 Example: 256.0 *signal currently not available for PIDs. |

## Position
| Name | Type | Description |
|------|------|-------------|
| latitude | double | Latitude of the vehicle event. ex: 52.404353 |
| longitude | double | Longitude of the vehicle event. ex: -6.207360 |

## HealthSignalObject
| Name | Type | Description |
|------|------|-------------|
| tag | HealthTag | Symptom, severity, category and action for the health event. |
| indicator_light | HealthIndicatorLight | Indicator light information. |
| dtc_code | string | Diagnostic Trouble Code. |
| timestamp | string | ISO 8601 formatted datetime string representing the signal emit time. All values are in UTC. |

## HealthTag
| Name | Type | Description |
|------|------|-------------|
| symptom | string | Cause for warning light indicator. |
| severity | Enum('URGENT','HIGH','MEDIUM','LOW') | Level of indicator severity. |
| category | string | Grouping of indicator based on impacted vehicle area. |
| action | string | ISO 8601 formatted datetime string representing the tagged signal emit time. All values are in UTC. |

## HealthIndicatorLight
| Name | Type | Description |
|------|------|-------------|
| well_known_indicator | string | Title of well known indicator signal. |
| indicator_state | Enum('ON','OFF') | Warning Light indicator on and off state. |
| value | string | Well known indicator light code. |

## HistoricalSignal
| Name | Type | Description |
|------|------|-------------|
| type | HistoricalSignalTypeEnum | |
| value | object | Value for the given signal. Data types will vary and are dependent on the type field. See HistoricalSignalTypeEnum for the data type mapping for each type string. |
| timestamp | string | ISO 8601 formatted datetime string representing the signal emit time. All values are in UTC. |

## HistoricalSignalTypeEnum
| Name | Description | Value Type |
|------|-------------|------------|
| position | Includes the latitude and longitude of the vehicle. Latitude: Units: degrees. Range: -90 to 90 Example: 42.326215 Longitude: Units: degrees Range: -180 to 180 Example: -83.211655 | PositionObject |
| odometer | Indicates the kilometers driven over the life of the vehicle. Units: kilometers Example: 1349 | double |
| speed | Indicates the speed of the vehicle. Units: m/s Example: 60 | double |
| iginition_status | Indicates the current ignition status of the vehicle. | IgnitionStatusEnum |
| seat_belt_status | Indicates the status of the seat belt for a specific seat. | SeatBeltStatus |
| fuel_level | Indicates the percentage of fuel remaining as reported by the vehicle. Units: percentage Range: -5.217408 to 105.9786 Example: 41.413176 | double |
| oil_life_remaining | The percentage oil life remaining for the vehicle. Units: percentage Range: 0 to 100 Example: 10 | double |
| battery_voltage | Number representing the current battery level in volts. Units: volts Range: 0 to 15.875 Example: 12.9375 | double |
| xev_battery_range | Estimated battery range. Units: kilometer | double |
| xev_battery_state_of_charge | State of charge of the XEV High Voltage battery expressed as a percentage. Units: percentage Range: 0 to 100 Example: 80 | double |
| xev_battery_charge_display_status | Display that will show the charging status or the use of charge from a charging station. | EVBatteryChargeDisplayStatusEnum |
| xev_plug_charger_status | Status of the electric vehicle's charger plug. | EVPlugChargerStatusEnum |
| total_engine_time | Indicates the number of total seconds the engine has been running during the vehicle lifetime. Units: seconds Example: 102 Note: Zero time is not valid and can be caused by a quick ignition on/off cycle. This signal is not available on all makes and models. | double |
| heading | Indicates the direction in which the vehicle is moving represented in degrees. Units: degrees Range: 0 to 360 Example: 256.0 *signal currently not available for PIDs. | double |

## PositionObject
| Name | Type | Description |
|------|------|-------------|
| latitude | double | Units: degrees. Range: -90 to 90 Example: 42.326215 |
| longitude | double | Units: degrees Range: -180 to 180 Example: -83.211655 |

## IgnitionStatusEnum
Indicates the current ignition status of the vehicle.

| Name | Description |
|------|-------------|
| Unknown | |
| Off | Ignition is currently turned off. |
| Accessory | Ignition is in accessory mode, but not turned on. |
| On | Vehicle is currently running. |

## SeatBeltStatus
Indicates the status of the seat belt for a specific seat.

| Name | Description |
|------|-------------|
| seatbelt_status | The seatbelt status of seat. |
| occupant_role | The occupant role of seat. |

## SeatbeltStatusEnum
| Name |
|------|
| UNKNOWN |
| BUCKLED |
| UNBUCKLED |

## OccupantRole
| Name |
|------|
| UNKNOWN |
| DRIVER |
| PASSENGER |

## TripSummary
| Name | Type | Description |
|------|------|-------------|
| tripStartTime | string | The start of the trip 8601 UTC timestamp. ex: 2023-10-02T00:00:00Z |
| startPosition | Position | The position including lat/lon for the trip start. |
| startOdometer | double | Odometer of the vehicle at trip start in km. ex: 216.0 |
| tripEndTime | string | The end of the trip 8601 UTC timestamp. ex: 2023-10-02T01:00:00Z |
| endPosition | Position | The position including lat/lon for the trip end. |
| endOdometer | double | Odometer of the vehicle at trip end in km. ex: 241.0 |
| tripDistance | double | Distance between start and end odometer in km. ex: 42.0 |

## VehicleMetadata
| Name | Type | Description |
|------|------|-------------|
| vin | string | Vehicle Identification Number. |
| vehicle_name | string | Name assigned to vehicle by fleet manager. |
| make | string | The vehicle's make. ex: Ford. |
| model | string | The vehicle's model. ex: Bronco. |
| year | integer | The vehicle's year. ex: 2023. |

## FuelTypeEnum
| Name |
|------|
| Gas |
| Electric |
| Hybrid |
| PluginHybrid |
| CompressedNaturalGas |
| FlexFuel |
| Diesel |

## EVPlugChargerStatusEnum
Status of the electric vehicle's charger plug.

| Name |
|------|
| UNKNOWN |
| DISCONNECTED |
| CONNECTED |
| UNRECOGNIZED |

## EVBatteryChargeDisplayStatusEnum
Display that will show the charging status or the use of charge from a charging station.

| Name |
|------|
| UNKNOWN |
| NOT_PLUGGED_IN |
| FAULT |
| STATION_NOT_COMPATIBLE |
| STATION_NOT_DETECTED |
| IN_PROGRESS |
| SCHEDULED |
| PAUSED |
| STOPPED |
| COMPLETED |
| UNRECOGNIZED |

## Relations
| Name | Type | Description |
|------|------|-------------|
| driver | DriverRelation | Details of the driver including name, email country, etc. |
| vehicle | VehicleRelation | Details of the vehicle including make, model, year, etc. |

## VehicleRelation
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Unique identifier for the vehicle. |
| vin | string | Vehicle Identification Number. |
| name | string | The customer given name of the vehicle. |
| make | string | The make of the vehicle. |
| model | string | The model of the vehicle. |
| year | string | The year the vehicle was produced. |

## DriverRelation
| Name | Type | Description |
|------|------|-------------|
| first_name | string | First name of the driver. |
| last_name | string | Last name of the driver. |
| country_code | string | Country code of the driver. |
| email | string | Email of the driver. |
| timezone | string | Timezone of the driver. |

## DriverLanguage
| Name | Type | Description |
|------|------|-------------|
| code | string | Language code. Example: fr-FR |

## User
| Name | Type | Description |
|------|------|-------------|
| user_id | UUID | Unique identifier of the user. |
| email | string | Email address of the user. |
| first_name | string | First name of the user. |
| last_name | string | Last name of the user. |
| country_code | string | Associated country of the user |
| application_names | List[String] | List of applications associated to the user. |

## SegmentResponse
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Unique identifier of the segment. |
| name | string | Name for the segment |

## DriverSegment
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Unique identifier of the segment. |

# Example Usage
In our example use case, we will go through how to use the API to request the state of a vehicle. In each step, bash and postman examples will be given.

## Authenticate
First, we use the authentication endpoint /token to retrieve our bearer token for use in subsequent requests.

### Authenticate Using Postman

```bash
curl -X POST  --data "clientId=${clientId}" --data "clientSecret=${clientSecret}" https://$AUTH_HOST/vehicle-status-api/token
```

```json
{
"access_token": "example",
"token_type": "Bearer",
"expires_in": "1744206587345"
}
```

Now that we have our bearer token, we can use it to retrieve our vehicle status.

## Request a Vehicle Status
We will use our bearer token and example VIN 1FMEU111111111111 to query the vehicle-status-api/v1/vehicle/:vin/status endpoint. We will also use the signal_filter get parameter to limit the resulting signals to position and odometer. The signal parameter is optional and if not included as part of the request, the response will contain all signals valid for the vehicles fuel type.

### Vehicle Status Using Postman

```bash
curl -X GET -H "Authorization: \"Bearer example\"" "https://${HOST}/vehicle-status-api/v1/vehicle/1FMEU111111111111/status?signal-filter=position,odometer"
```

```json
{
"vin": "1FMEU111111111111",
"fuelType": "Gas",
"signals": [
{
"position": {
"timestamp": "2023-01-26T22:01:01.663Z",
"value": {
"latitude": 42.296436,
"longitude": -83.207819
}
}
},
{
"odometer": {
"timestamp": "2023-01-26T22:01:01.663Z",
"value": 24000.0
}
}
]
}
```

## Notes on FuelType
The signals returned from the status API are dependent on the fuel type of the vehicle. Below is a table outlining what signals can be expected for each fuel type.

| Signal | Gas | Electric | Diesel | CompressedNaturalGas | FlexFuel | Hybrid | PluginHybrid |
|--------|-----|----------|--------|----------------------|----------|---------|--------------|
| position | x | x | x | x | x | x | x |
| odometer | x | x | x | x | x | x | x |
| ignition_status | x | x | x | x | x | x | x |
| oil_life_remaining | x |  | x | x | x | x | x |
| fuel_level | x |  | x | x | x | x | x |
| total_engine_time | x |  | x | x | x | x | x |
| battery_voltage | x | x | x | x | x | x | x |
| xev_battery_state_of_charge |  | x |  |  |  | x | x |
| xev_battery_range |  | x |  |  |  | x | x |
| xev_plug_charger_status |  | x |  |  |  |  | x |
| xev_battery_charge_display_status |  | x |  |  |  |  | x |
| heading | x | x | x | x | x | x | x |

If FuelType is not found, all signals will be returned. Fuel type is currently not available for non-Ford vehicles.

## Request Vehicle Health Alert Diagnostic Processed Events
We will use our bearer token and example VIN 1FMEU111111111111 to query the vehicle-status-api/v1/vehicle/:vin/health endpoint.

See the API Reference for more details.

```bash
curl -X GET -H "Authorization: \"Bearer example\"" "https://${HOST}/vehicle-status-api/v1/vehicle/1FMEU111111111111/health"
```

```json
{
"vin": "1FMEU111111111111",
"signals": [
{
"tag": {
"symptom": "Active park assist may not activate.  Active park assist switch has a fault.",
"severity": "LOW",
"category": "Restraints & Driver Assistance",
"action": "Have the parking aid system checked by an authorized dealer as soon as possible."
},
"indicator_light": {
"well_known_indicator": "PARK_AID_MALFUNCTION",
"indicator_state": "ON",
"value": "600E01"
},
"dtc_code": "B129E",
"timestamp": "2022-02-18T14:45:01Z"
}
]
}
```

## Request Historical Vehicle Signals
We will use our bearer token and example VIN 1FMEU111111111111 to query the vehicle-status-api/v1/vehicle/:vin/historical endpoint. This endpoint has two required get parameters, start-time and end-time.
All signals returned by this endpoint will have been emitted between the start-time and end-time. In this example we will query for a one hour window. We will also set the page-size to three signals, though for practical uses a larger page-size is recommended.

See the API Reference for more details.

```bash
curl -X GET -H "Authorization: \"Bearer example\"" "https://${HOST}/vehicle-status-api/v1/vehicle/1FMEU111111111111/historical?start-time=2023-02-01T14:00:00Z&end-time=2023-02-01T15:00:00Z&page-size=3"
```

```json
{
"vin": "1FMEU111111111111",
"fuel_type": "Gas",
"start_time": "2023-02-01T14:00:00Z",
"end_time": "2023-02-01T15:00:00Z",
"page_count": 3,
"next_page": '2:1687842896214',
"page_size": 3,
"resolution": null,
"signals": [
{
"type": "position",
"value": {
"latitude": 1.0,
"longitude": 2.0
},
"timestamp": "2023-02-01T14:55:30Z"
},
{
"type": "odometer",
"value": 1099.15,
"timestamp": "2023-02-01T14:55:30Z"
},
{
"type": "speed",
"value": 15.6,
"timestamp": "2023-02-01T14:55:30Z"
}
]
}
```

Note that the signals list displays signals in order of timestamp descending.

To retrieve the next page of data, we use the value of the next_page key as the page parameter in our request.

```bash
curl -X GET -H "Authorization: \"Bearer example\"" "https://${HOST}/vehicle-status-api/v1/vehicle/1FMEU111111111111/historical?start-time=2023-02-01T14:00:00Z&end-time=2023-02-01T15:00:00Z&page-size=3&page=2:1687842896214"
```

```json
{
"vin": "1FMEU111111111111",
"fuel_type": "Gas",
"start_time": "2023-02-01T14:00:00Z",
"end_time": "2023-02-01T15:00:00Z",
"page_count": 3,
"next_page": '9:1687826493602',
"page_size": 3,
"resolution": null,
"signals": [
{
"type": "odometer",
"value": 1098.98,
"timestamp": "2023-02-01T14:54:50Z"
},
{
"type": "speed",
"value": 15.8,
"timestamp": "2023-02-01T14:54:50Z"
},
{
"type": "speed",
"value": 17.2,
"timestamp": "2023-02-01T14:54:10Z"
}
]
}
```

# Getting started: Telematics API
The Telematics API is a RESTful API that provides users the ability to programmatically retrieve telematics data for their enrolled fleet vehicles.

## Request API Credentials
API credentials are required to utilize the Telematics API. Two values are needed, a clientID and a clientSecret. Admin users can create these credentials on the Credential Management page.

## Prerequisites
To access vehicle data using the Ford Telematics REST APIs, you must first configure the customer's Fleet Marketplace account to ensure your API user has access to the relevant VINs. Please follow the below steps on your Ford Fleet Marketplace account before attempting to access your data via the APIs.

### Ensure your VIN(s) are enrolled into a Ford Telematics paid product
Select 'Fleet' tab
To enroll a single VIN
Select VIN
Select 'Subscribe to Product'
Select a Product
Select "Subscribe"
Check that enrollment was successful by reviewing the 'Status' column. If it has a green tick, enrollment was successful.
To enroll multiple VINs
Select the relevant VINs
Select 'Bulk Actions'
Select 'Subscribe to Product'
Select a Product
Select 'Subscribe'
Check that enrollment was successful by reviewing the 'Status' column. If it has a green tick, enrollment was successful.
NOTE: Credentials created as of December 1st, 2023 will be able to access vehicles that are unassigned to a group in Fleet Marketplace. If you have credentials from before this date, please follow the below steps.

### Ensure your Fleet Marketplace Groups are configured
Select 'Groups' tab
Select 'Create Group'
Write a 'Group Name'
Select 'Modify Vehicles'
Select relevant VIN(s)
Select 'Add Vehicles'
Select 'Modify Users'
Select User(s), make sure you add the API user to this group if you want to access these VINs via the API
Select 'Add Users'
Select 'Create Group'

### Ensure your API User is set up to access the relevant VINs/Groups
Select 'Users' tab
Select the API user
Select 'Bulk Actions'
Select 'Add to Group'
Select Group(s)
Select 'Add to Group(s)'

## Base URL
The Telematics API base url is: https://api.fordpro.com/vehicle-status-api/.

This will be used as the ${HOST} variable in the Example Usage guide and is the prefix for all endpoints in API Endpoints.

See Example Usage to get started or visit the API Endpoints reference for more details.

# Authentication
All endpoints in the Telematics API require bearer token authentication. Unauthenticated requests will receive a 401 status code response.

To retrieve a bearer token, send a POST request to the /token endpoint using your clientId and clientSecret as parameters.

## Example
```bash
curl -X POST  --data "clientId=${clientId}" --data "clientSecret=${clientSecret}" https://${HOST}/vehicle-status-api/token
```

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": "1675667857713"
}
```

The access_token value will be used as our bearer token to authenticate requests to the Telematics API.

Your access_token will expire after the expires_in time in the response body. This is 5 minutes after the initial request time.
If you encounter a 504 timeout error from this endpoint, we recommend retrying the request using an exponential backoff strategy.