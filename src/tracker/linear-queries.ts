/**
 * GraphQL query strings for Linear API, isolated for testability.
 */

export const CANDIDATE_ISSUES_QUERY = `
query CandidateIssues($projectSlug: String!, $stateNames: [String!]!, $after: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $stateNames } }
    }
    first: 50
    after: $after
    orderBy: createdAt
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      title
      description
      priority
      url
      createdAt
      updatedAt
      branchName
      state {
        name
      }
      labels {
        nodes {
          name
        }
      }
      relations(first: 100) {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
      inverseRelations(first: 100) {
        nodes {
          type
          issue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
    }
  }
}
`;

export const ISSUES_BY_STATES_QUERY = `
query IssuesByStates($projectSlug: String!, $stateNames: [String!]!, $after: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $stateNames } }
    }
    first: 50
    after: $after
    orderBy: createdAt
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      state {
        name
      }
    }
  }
}
`;

export const ISSUE_STATES_BY_IDS_QUERY = `
query IssueStatesByIds($ids: [ID!]!) {
  issues(
    filter: {
      id: { in: $ids }
    }
    first: 50
  ) {
    nodes {
      id
      identifier
      title
      description
      priority
      url
      createdAt
      updatedAt
      branchName
      state {
        name
      }
      labels {
        nodes {
          name
        }
      }
      relations(first: 100) {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
      inverseRelations(first: 100) {
        nodes {
          type
          issue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
    }
  }
}
`;
