export interface JobberProperty {
    id: string;
    address: {
        street: string;
        city: string;
        province: string;
        postalCode: string;
        country: string;
        latitude?: number;
        longitude?: number;
    };
    client: {
        id: string;
        firstName: string;
        lastName: string;
        companyName?: string;
    };
    customFields?: any[];
}

export interface JobberClient {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    properties: JobberProperty[];
}

export class JobberAPIClient {
    private accessToken: string | null = null;
    private apiUrl = 'https://api.getjobber.com/api/graphql';

    constructor(
        private clientId: string = process.env.JOBBER_CLIENT_ID || '',
        private clientSecret: string = process.env.JOBBER_CLIENT_SECRET || ''
    ) {}

    async authenticate(): Promise<void> {
        // OAuth 2.0 authentication flow
        // This would typically be done through a browser flow
        // For now, we'll use stored access token from environment
        this.accessToken = process.env.JOBBER_ACCESS_TOKEN || null;
        
        if (!this.accessToken) {
            throw new Error('Jobber access token not available. Please complete OAuth flow.');
        }
    }

    private async makeGraphQLRequest(query: string, variables?: any): Promise<any> {
        if (!this.accessToken) {
            await this.authenticate();
        }

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query,
                variables
            })
        });

        if (!response.ok) {
            throw new Error(`Jobber API request failed: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        return data.data;
    }

    async getAllProperties(): Promise<JobberProperty[]> {
        const query = `
            query GetAllProperties($first: Int, $after: String) {
                properties(first: $first, after: $after) {
                    edges {
                        node {
                            id
                            address {
                                street
                                city
                                province
                                postalCode
                                country
                                latitude
                                longitude
                            }
                            client {
                                id
                                firstName
                                lastName
                                companyName
                            }
                            customFields {
                                name
                                value
                            }
                        }
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        `;

        let allProperties: JobberProperty[] = [];
        let hasNextPage = true;
        let after: string | null = null;

        while (hasNextPage) {
            const variables: any = { first: 100, after };
            const data: any = await this.makeGraphQLRequest(query, variables);
            
            const properties = data.properties.edges.map((edge: any) => edge.node);
            allProperties = allProperties.concat(properties);
            
            hasNextPage = data.properties.pageInfo.hasNextPage;
            after = data.properties.pageInfo.endCursor;
        }

        return allProperties;
    }

    async getClientsWithProperties(): Promise<JobberClient[]> {
        const query = `
            query GetClientsWithProperties($first: Int, $after: String) {
                clients(first: $first, after: $after) {
                    edges {
                        node {
                            id
                            firstName
                            lastName
                            companyName
                            clientProperties(first: 50) {
                                edges {
                                    node {
                                        id
                                        address {
                                            street
                                            city
                                            province
                                            postalCode
                                            country
                                            latitude
                                            longitude
                                        }
                                        customFields {
                                            name
                                            value
                                        }
                                    }
                                }
                            }
                        }
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        `;

        let allClients: JobberClient[] = [];
        let hasNextPage = true;
        let after: string | null = null;

        while (hasNextPage) {
            const variables: any = { first: 100, after };
            const data: any = await this.makeGraphQLRequest(query, variables);
            
            const clients = data.clients.edges.map((edge: any) => ({
                id: edge.node.id,
                firstName: edge.node.firstName,
                lastName: edge.node.lastName,
                companyName: edge.node.companyName,
                properties: edge.node.clientProperties.edges.map((propEdge: any) => ({
                    id: propEdge.node.id,
                    address: propEdge.node.address,
                    client: {
                        id: edge.node.id,
                        firstName: edge.node.firstName,
                        lastName: edge.node.lastName,
                        companyName: edge.node.companyName
                    },
                    customFields: propEdge.node.customFields
                }))
            }));
            
            allClients = allClients.concat(clients);
            
            hasNextPage = data.clients.pageInfo.hasNextPage;
            after = data.clients.pageInfo.endCursor;
        }

        return allClients;
    }

    async getTodaysJobs(): Promise<any[]> {
        const today = new Date().toISOString().split('T')[0];
        
        const query = `
            query GetTodaysJobs($startDate: Date!, $endDate: Date!) {
                jobs(filter: { startDate: $startDate, endDate: $endDate }) {
                    edges {
                        node {
                            id
                            title
                            startAt
                            endAt
                            jobStatus
                            client {
                                id
                                firstName
                                lastName
                                companyName
                            }
                            property {
                                id
                                address {
                                    street
                                    city
                                    province
                                    postalCode
                                    latitude
                                    longitude
                                }
                            }
                        }
                    }
                }
            }
        `;

        const variables = { 
            startDate: today, 
            endDate: today 
        };
        
        const data = await this.makeGraphQLRequest(query, variables);
        return data.jobs.edges.map((edge: any) => edge.node);
    }
}

export const jobberClient = new JobberAPIClient();