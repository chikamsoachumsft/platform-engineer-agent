targetScope = 'resourceGroup'

@description('Base name for all resources')
param appName string = 'pe-agent'

@description('Azure region')
param location string = resourceGroup().location

@description('Container image tag')
param imageTag string = 'latest'

@description('GitHub App ID')
@secure()
param githubAppId string

@description('GitHub App Private Key (base64 encoded)')
@secure()
param githubAppPrivateKey string

@description('GitHub Webhook Secret')
@secure()
param githubWebhookSecret string

@description('Azure AD Tenant ID')
param azureTenantId string

@description('Azure AD Client ID for the agent')
param azureClientId string

@description('Azure AD Client Secret for the agent')
@secure()
param azureClientSecret string

@description('Agent public base URL')
param agentBaseUrl string = ''

// ── Container Registry ──────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: replace('${appName}acr', '-', '')
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
  }
}

// ── Log Analytics Workspace ─────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Application Insights ────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${appName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── Container Apps Environment ──────────────────────────────────────

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    daprAIInstrumentationKey: appInsights.properties.InstrumentationKey
  }
}

// ── Managed Identity ────────────────────────────────────────────────

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-id'
  location: location
}

// ── ACR Pull role assignment ────────────────────────────────────────

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull built-in role

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Container App ───────────────────────────────────────────────────

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        { name: 'github-app-id', value: githubAppId }
        { name: 'github-app-private-key', value: githubAppPrivateKey }
        { name: 'github-webhook-secret', value: githubWebhookSecret }
        { name: 'azure-client-secret', value: azureClientSecret }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: '${acr.properties.loginServer}/${appName}:${imageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            { name: 'PORT', value: '3000' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'GITHUB_APP_ID', secretRef: 'github-app-id' }
            { name: 'GITHUB_APP_PRIVATE_KEY', secretRef: 'github-app-private-key' }
            { name: 'GITHUB_WEBHOOK_SECRET', secretRef: 'github-webhook-secret' }
            { name: 'AZURE_TENANT_ID', value: azureTenantId }
            { name: 'AZURE_CLIENT_ID', value: azureClientId }
            { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' }
            { name: 'AGENT_BASE_URL', value: agentBaseUrl != '' ? agentBaseUrl : 'https://${appName}.${containerAppEnv.properties.defaultDomain}' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [acrPullAssignment]
}

// ── Outputs ─────────────────────────────────────────────────────────

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output acrLoginServer string = acr.properties.loginServer
output identityClientId string = identity.properties.clientId
output appInsightsConnectionString string = appInsights.properties.ConnectionString
